package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/unixshells/vt-go"
	"golang.org/x/sys/unix"
)

const (
	maxPanes       = 10
	scrollbackSize = 1000
	renderFPS      = 30
)

// YuanMsg is a JSON protocol message between mux and Yuan agent.
type YuanMsg struct {
	Type    string `json:"type"`
	Text    string `json:"text,omitempty"`
	Session int    `json:"session,omitempty"`
	Data    string `json:"data,omitempty"`
	Code    int    `json:"code,omitempty"`
}

// Pane represents a single full-screen terminal pane.
type Pane struct {
	id   int
	name string
	emu  *vt.SafeEmulator

	// Local shell
	cmd *exec.Cmd
	sin io.WriteCloser

	// 9p pipe session (Yuan)
	pipeIn  *os.File // JS→mux
	pipeOut *os.File // mux→JS

	mu       sync.Mutex
	activity bool
	exited   bool

	// Line buffer for local echo editing (shell has no TTY)
	lineBuf []byte
}

// Mux is the terminal multiplexer.
type Mux struct {
	panes  []*Pane
	active int
	rows   int
	cols   int

	mu    sync.Mutex
	ctrlB bool

	renderCh chan struct{}
	stopCh   chan struct{}
	saved    *unix.Termios

	// Escape sequence parser for resize: \x1b[8;rows;colst
	escBuf []byte
}

func main() {
	rows, cols := 24, 80
	// Try ioctl first (works on real terminals)
	if c, r, err := termSize(int(os.Stdin.Fd())); err == nil && c > 0 && r > 0 {
		cols, rows = c, r
	}
	// Check env vars (set by init-terminal)
	if s := os.Getenv("COLUMNS"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 {
			cols = v
		}
	}
	if s := os.Getenv("LINES"); s != "" {
		if v, err := strconv.Atoi(s); err == nil && v > 0 {
			rows = v
		}
	}

	saved, err := setRaw(int(os.Stdin.Fd()))
	if err != nil {
		saved = nil
	}

	m := &Mux{
		rows:     rows,
		cols:     cols,
		renderCh: make(chan struct{}, 8),
		stopCh:   make(chan struct{}),
		saved:    saved,
	}
	defer m.restore()

	// Pane 0: local shell
	if err := m.newLocalShell(); err != nil {
		os.Exit(1)
	}

	// Pane 1: Yuan chat (optional, requires sessionfs)
	m.tryYuanChat()

	// Clear screen and start
	os.Stdout.Write([]byte("\x1b[2J\x1b[H"))
	go m.renderLoop()
	m.triggerRender() // initial render so screen isn't blank

	// Handle signals
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sigCh
		m.restore()
		os.Exit(0)
	}()

	m.readInput()
}

func (m *Mux) restore() {
	if m.saved != nil {
		unix.IoctlSetTermios(int(os.Stdin.Fd()), unix.TCSETS, m.saved)
	}
	os.Stdout.Write([]byte("\x1b[?25h\x1b[2J\x1b[H"))
}

// --- Terminal helpers ---

func setRaw(fd int) (*unix.Termios, error) {
	t, err := unix.IoctlGetTermios(fd, unix.TCGETS)
	if err != nil {
		return nil, err
	}
	s := *t
	t.Iflag &^= unix.IGNBRK | unix.BRKINT | unix.PARMRK | unix.ISTRIP |
		unix.INLCR | unix.IGNCR | unix.ICRNL | unix.IXON
	t.Oflag &^= unix.OPOST
	t.Lflag &^= unix.ECHO | unix.ECHONL | unix.ICANON | unix.ISIG | unix.IEXTEN
	t.Cflag &^= unix.CSIZE | unix.PARENB
	t.Cflag |= unix.CS8
	t.Cc[unix.VMIN] = 1
	t.Cc[unix.VTIME] = 0
	return &s, unix.IoctlSetTermios(fd, unix.TCSETS, t)
}

func termSize(fd int) (int, int, error) {
	ws, err := unix.IoctlGetWinsize(fd, unix.TIOCGWINSZ)
	if err != nil {
		return 0, 0, err
	}
	return int(ws.Col), int(ws.Row), nil
}

// --- Pane management ---

func (m *Mux) paneHeight(pane *Pane) int {
	if pane != nil && pane.emu.IsAltScreen() {
		return m.rows
	}
	return m.rows - 1
}

func (m *Mux) newLocalShell() error {
	h := m.rows - 1
	emu := vt.NewSafeEmulator(m.cols, h)

	cmd := exec.Command("/bin/sh", "-i")
	cmd.Env = append(os.Environ(),
		"TERM=xterm",
		fmt.Sprintf("COLUMNS=%d", m.cols),
		fmt.Sprintf("LINES=%d", h),
		"PS1=/ # ",
	)

	sin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	sout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	serr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}

	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := cmd.Start(); err != nil {
		return err
	}

	p := &Pane{
		id:   len(m.panes),
		name: "local",
		emu:  emu,
		cmd:  cmd,
		sin:  sin,
	}
	m.panes = append(m.panes, p)

	go m.feedOutput(p, sout)
	go m.feedOutput(p, serr)
	go func() {
		cmd.Wait()
		p.mu.Lock()
		p.exited = true
		p.mu.Unlock()
		// If pane 0 exits, exit the mux
		if p.id == 0 {
			m.restore()
			os.Exit(0)
		}
		m.triggerRender()
	}()

	return nil
}

func (m *Mux) tryYuanChat() {
	// Pipe routing (both ends use "out" = Port2):
	//   mux writes to "out" → buffer1 → JS reads from "in" (buffer1)
	//   JS writes to "in" → buffer2 → mux reads from "out" (buffer2)
	pipeOut, err := os.OpenFile("/#sessions/0/out", os.O_WRONLY, 0)
	if err != nil {
		pipeOut, err = os.OpenFile("/sessions/0/out", os.O_WRONLY, 0)
	}
	if err != nil {
		return
	}
	pipeIn, err := os.OpenFile("/#sessions/0/out", os.O_RDONLY, 0)
	if err != nil {
		pipeIn, err = os.OpenFile("/sessions/0/out", os.O_RDONLY, 0)
	}
	if err != nil {
		pipeOut.Close()
		return
	}

	h := m.rows - 1
	emu := vt.NewSafeEmulator(m.cols, h)

	p := &Pane{
		id:      1,
		name:    "yuan",
		emu:     emu,
		pipeIn:  pipeIn,
		pipeOut: pipeOut,
	}
	m.panes = append(m.panes, p)

	// Debug: show pipe state
	p.emu.Write([]byte(fmt.Sprintf("[yuan] pipes opened: out=%v in=%v\r\n", pipeOut != nil, pipeIn != nil)))

	// Read Yuan JSON messages
	go m.readYuanMsgs(p)
}

func (m *Mux) spawnYuanShell() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.panes) >= maxPanes {
		return
	}

	id := len(m.panes)
	h := m.rows - 1
	emu := vt.NewSafeEmulator(m.cols, h)

	// Open single pipe file bidirectionally (mux side = c1 = "in")
	pipePath := fmt.Sprintf("/#sessions/%d/in", id)
	pipe, err := os.OpenFile(pipePath, os.O_RDWR, 0)
	if err != nil {
		// Pipe not available, spawn local shell instead
		m.spawnWatchShell(id, emu)
		return
	}

	name := fmt.Sprintf("shell-%d", id-1)
	p := &Pane{
		id:      id,
		name:    name,
		emu:     emu,
		pipeIn:  pipe,
		pipeOut: pipe,
	}
	m.panes = append(m.panes, p)

	// Fork/exec shell with mux-mediated I/O
	cmd := exec.Command("/bin/sh", "-i")
	cmd.Env = append(os.Environ(),
		"TERM=xterm",
		fmt.Sprintf("COLUMNS=%d", m.cols),
		fmt.Sprintf("LINES=%d", h),
		"PS1=/ # ",
	)

	sin, _ := cmd.StdinPipe()
	sout, _ := cmd.StdoutPipe()
	serr, _ := cmd.StderrPipe()
	p.sin = sin
	p.cmd = cmd

	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Start()

	// Shell output → emulator + 9p pipe out
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := sout.Read(buf)
			if n > 0 {
				p.emu.Write(buf[:n])
				p.mu.Lock()
				p.activity = true
				p.mu.Unlock()
				// Forward to Yuan via 9p pipe
				msg := YuanMsg{Type: "output", Session: id, Data: string(buf[:n])}
				if data, err := json.Marshal(msg); err == nil {
					data = append(data, '\n')
					pipe.Write(data)
				}
				m.triggerRender()
			}
			if err != nil {
				break
			}
		}
	}()
	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := serr.Read(buf)
			if n > 0 {
				p.emu.Write(buf[:n])
				p.mu.Lock()
				p.activity = true
				p.mu.Unlock()
				msg := YuanMsg{Type: "output", Session: id, Data: string(buf[:n])}
				if data, err := json.Marshal(msg); err == nil {
					data = append(data, '\n')
					pipe.Write(data)
				}
				m.triggerRender()
			}
			if err != nil {
				break
			}
		}
	}()

	// 9p pipe in → shell stdin (Yuan writes commands)
	go func() {
		dec := json.NewDecoder(pipe)
		for {
			var msg YuanMsg
			if err := dec.Decode(&msg); err != nil {
				break
			}
			if msg.Type == "write" && msg.Session == id {
				sin.Write([]byte(msg.Data))
			}
		}
	}()

	go func() {
		cmd.Wait()
		p.mu.Lock()
		p.exited = true
		p.mu.Unlock()
		// Notify Yuan
		msg := YuanMsg{Type: "exited", Session: id, Code: cmd.ProcessState.ExitCode()}
		if data, err := json.Marshal(msg); err == nil {
			data = append(data, '\n')
			pipe.Write(data)
		}
		m.triggerRender()
	}()

	// Notify Yuan that shell was spawned
	spawned := YuanMsg{Type: "spawned", Session: id}
	if data, err := json.Marshal(spawned); err == nil {
		data = append(data, '\n')
		if yuanPipe := m.yuanPipeOut(); yuanPipe != nil {
			yuanPipe.Write(data)
		}
	}
}

func (m *Mux) spawnWatchShell(id int, emu *vt.SafeEmulator) {
	// Fallback: spawn a local shell without 9p pipes
	name := fmt.Sprintf("shell-%d", id-1)
	cmd := exec.Command("/bin/sh", "-i")
	cmd.Env = append(os.Environ(),
		"TERM=xterm",
		fmt.Sprintf("COLUMNS=%d", m.cols),
		fmt.Sprintf("LINES=%d", m.rows-1),
		"PS1=/ # ",
	)
	sin, _ := cmd.StdinPipe()
	sout, _ := cmd.StdoutPipe()
	serr, _ := cmd.StderrPipe()

	p := &Pane{id: id, name: name, emu: emu, cmd: cmd, sin: sin}
	m.panes = append(m.panes, p)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Start()

	go m.feedOutput(p, sout)
	go m.feedOutput(p, serr)
	go func() {
		cmd.Wait()
		p.mu.Lock()
		p.exited = true
		p.mu.Unlock()
		m.triggerRender()
	}()
}

func (m *Mux) closePane(idx int) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if idx <= 1 || idx >= len(m.panes) {
		return
	}

	p := m.panes[idx]
	if p.cmd != nil && p.cmd.Process != nil {
		p.cmd.Process.Kill()
	}
	if p.sin != nil {
		p.sin.Close()
	}
	if p.pipeIn != nil {
		p.pipeIn.Close()
	}
	if p.pipeOut != nil {
		p.pipeOut.Close()
	}

	m.panes = append(m.panes[:idx], m.panes[idx+1:]...)
	if m.active >= len(m.panes) {
		m.active = len(m.panes) - 1
	}
	m.triggerRender()
}

func (m *Mux) switchPane(idx int) {
	if idx < 0 || idx >= len(m.panes) || idx == m.active {
		return
	}
	m.mu.Lock()
	m.panes[idx].mu.Lock()
	m.panes[idx].activity = false
	m.panes[idx].mu.Unlock()
	m.active = idx
	m.mu.Unlock()
	m.triggerRender()
}

func (m *Mux) yuanPipeOut() *os.File {
	for _, p := range m.panes {
		if p.id == 1 && p.pipeOut != nil {
			return p.pipeOut
		}
	}
	return nil
}

// --- I/O ---

func (m *Mux) feedOutput(p *Pane, r io.Reader) {
	buf := make([]byte, 4096)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			// Translate bare \n to \r\n for VT emulator
			clean := bytes.ReplaceAll(buf[:n], []byte("\n"), []byte("\r\n"))
			p.emu.Write(clean)
			p.mu.Lock()
			p.activity = true
			p.mu.Unlock()
			m.triggerRender()
		}
		if err != nil {
			break
		}
	}
}

func (m *Mux) readYuanMsgs(p *Pane) {
	p.emu.Write([]byte("[yuan] readYuanMsgs started\r\n"))
	m.triggerRender()
	for {
		// Read from response buffer file (regular file, no blocking)
		data, err := os.ReadFile("/#sessions/0/response")
		if err != nil {
			data, err = os.ReadFile("/sessions/0/response")
		}
		if err == nil && len(data) > 0 {
			for _, line := range bytes.Split(data, []byte{'\n'}) {
				if len(line) == 0 {
					continue
				}
				var msg YuanMsg
				if json.Unmarshal(line, &msg) == nil {
					m.handleYuanMsg(p, &msg)
				}
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
}

func (m *Mux) handleYuanMsg(p *Pane, msg *YuanMsg) {
	switch msg.Type {
	case "chat":
		text := bytes.ReplaceAll([]byte(msg.Text), []byte("\n"), []byte("\r\n"))
		line := fmt.Sprintf("Yuan: %s\r\n", text)
		p.emu.Write([]byte(line))
		p.mu.Lock()
		p.activity = true
		p.mu.Unlock()
		m.triggerRender()
	case "spawn":
		m.spawnYuanShell()
	case "write":
		m.mu.Lock()
		for _, pp := range m.panes {
			if pp.id == msg.Session && pp.sin != nil {
				pp.sin.Write([]byte(msg.Data))
				break
			}
		}
		m.mu.Unlock()
	case "kill":
		m.closePane(msg.Session)
	}
}

func (m *Mux) readInput() {
	buf := make([]byte, 1024)
	for {
		n, err := os.Stdin.Read(buf)
		if err != nil {
			return
		}
		for _, b := range buf[:n] {
			m.handleInputByte(b)
		}
	}
}

func (m *Mux) handleInputByte(b byte) {
	// Escape sequence buffering: look for \x1b[8;ROWS;COLSt
	if len(m.escBuf) > 0 || b == 0x1b {
		m.escBuf = append(m.escBuf, b)
		// Check for complete CSI 8;rows;cols t sequence
		if b == 't' && len(m.escBuf) >= 6 && m.escBuf[0] == 0x1b && m.escBuf[1] == '[' {
			m.handleResizeSeq()
			m.escBuf = m.escBuf[:0]
			return
		}
		// Timeout: if buffer gets too long without matching, flush
		if len(m.escBuf) > 20 {
			for _, eb := range m.escBuf {
				m.handleKey(eb)
			}
			m.escBuf = m.escBuf[:0]
		}
		return
	}
	m.handleKey(b)
}

func (m *Mux) handleResizeSeq() {
	// Parse \x1b[8;ROWS;COLSt
	s := string(m.escBuf)
	if !strings.HasPrefix(s, "\x1b[8;") {
		// Not a resize sequence, forward as keystrokes
		for _, b := range m.escBuf {
			m.handleKey(b)
		}
		return
	}
	parts := strings.Split(s[4:len(s)-1], ";") // between "8;" and "t"
	if len(parts) != 2 {
		return
	}
	rows, err1 := strconv.Atoi(parts[0])
	cols, err2 := strconv.Atoi(parts[1])
	if err1 != nil || err2 != nil || cols < 10 || rows < 5 {
		return
	}

	m.mu.Lock()
	m.rows = rows
	m.cols = cols
	m.mu.Unlock()

	// Log resize to active pane
	if len(m.panes) > m.active {
		m.panes[m.active].emu.Write([]byte(fmt.Sprintf("\r\n[mux] resize: %dx%d\r\n", cols, rows)))
	}
	for _, p := range m.panes {
		h := rows - 1
		if p.emu.IsAltScreen() {
			h = rows
		}
		p.emu.Resize(cols, h)
	}
	m.triggerRender()
}

func (m *Mux) handleKey(b byte) {
	if m.ctrlB {
		m.ctrlB = false
		m.handleCtrlB(b)
		return
	}

	if b == 0x02 { // Ctrl+B
		m.ctrlB = true
		return
	}

	// Forward to active pane
	m.mu.Lock()
	p := m.panes[m.active]
	m.mu.Unlock()

	if p.id == 1 {
		// Yuan chat: buffer until Enter, send as JSON
		m.handleYuanInput(p, b)
		return
	}

	// Alt screen mode (vi, less, etc): raw passthrough, no line editing
	if p.emu.IsAltScreen() {
		if p.sin != nil {
			p.sin.Write([]byte{b})
		}
		return
	}

	// Ctrl+C: send SIGINT to foreground process group
	if b == 0x03 {
		if p.cmd != nil && p.cmd.Process != nil {
			syscall.Kill(-p.cmd.Process.Pid, syscall.SIGINT)
		}
		p.emu.Write([]byte("^C\r\n"))
		p.lineBuf = p.lineBuf[:0]
		m.triggerRender()
		return
	}
	// Ctrl+Z: send SIGTSTP
	if b == 0x1a {
		if p.cmd != nil && p.cmd.Process != nil {
			syscall.Kill(-p.cmd.Process.Pid, syscall.SIGTSTP)
		}
		return
	}

	// Local shell / Yuan shell: line editing + local echo
	// (shell has no TTY so we handle line editing ourselves)
	if p.sin != nil {
		switch {
		case b == 0x0d || b == 0x0a: // Enter
			p.sin.Write(p.lineBuf)
			p.sin.Write([]byte{'\n'})
			p.emu.Write([]byte("\r\n"))
			p.lineBuf = p.lineBuf[:0]
		case b == 0x7f || b == 0x08: // Backspace
			if len(p.lineBuf) > 0 {
				p.lineBuf = p.lineBuf[:len(p.lineBuf)-1]
				p.emu.Write([]byte("\b \b"))
			}
		case b == 0x15: // Ctrl+U: clear line
			for range p.lineBuf {
				p.emu.Write([]byte("\b \b"))
			}
			p.lineBuf = p.lineBuf[:0]
		case b >= 0x20 && b < 0x7f: // Printable
			p.lineBuf = append(p.lineBuf, b)
			p.emu.Write([]byte{b})
		default:
			// Forward other control chars directly
			p.sin.Write([]byte{b})
		}
		m.triggerRender()
	}
}

func (m *Mux) handleYuanInput(p *Pane, b byte) {
	if b == 0x0d || b == 0x0a { // Enter
		text := string(p.lineBuf)
		p.lineBuf = p.lineBuf[:0]
		p.emu.Write([]byte("\r\n"))
		m.triggerRender()
		// Async pipe write — never block input loop
		if p.pipeOut != nil && text != "" {
			msg := YuanMsg{Type: "chat", Text: text}
			if data, err := json.Marshal(msg); err == nil {
				data = append(data, '\n')
				p.pipeOut.Write(data)
			}
		}
		return
	}

	switch {
	case b == 0x7f || b == 0x08: // Backspace
		if len(p.lineBuf) > 0 {
			p.lineBuf = p.lineBuf[:len(p.lineBuf)-1]
			p.emu.Write([]byte("\b \b"))
		}
	case b == 0x15: // Ctrl+U: clear line
		for range p.lineBuf {
			p.emu.Write([]byte("\b \b"))
		}
		p.lineBuf = p.lineBuf[:0]
	case b >= 0x20 && b < 0x7f: // Printable
		p.lineBuf = append(p.lineBuf, b)
		p.emu.Write([]byte{b})
	}
	m.triggerRender()
}

func (m *Mux) handleCtrlB(b byte) {
	switch {
	case b >= '0' && b <= '9':
		m.switchPane(int(b - '0'))
	case b == 'n':
		next := m.active + 1
		if next >= len(m.panes) {
			next = 0
		}
		m.switchPane(next)
	case b == 'p':
		prev := m.active - 1
		if prev < 0 {
			prev = len(m.panes) - 1
		}
		m.switchPane(prev)
	case b == 'd':
		if m.active > 1 {
			m.closePane(m.active)
		}
	case b == 'c':
		// Create new local shell
		m.mu.Lock()
		if len(m.panes) < maxPanes {
			m.mu.Unlock()
			m.newLocalShell()
			m.switchPane(len(m.panes) - 1)
		} else {
			m.mu.Unlock()
		}
	case b == '?':
		// Show help overlay
		m.showHelp()
	}
}

func (m *Mux) showHelp() {
	// Write help text to a temporary overlay
	// For v1, just show in the active pane
	help := "\r\n--- session-mux help ---\r\n" +
		"Ctrl+B 0-9  Switch to pane\r\n" +
		"Ctrl+B n/p  Next/prev pane\r\n" +
		"Ctrl+B c    New shell\r\n" +
		"Ctrl+B d    Close pane (>1)\r\n" +
		"Ctrl+B ?    This help\r\n" +
		"------------------------\r\n\r\n"
	m.mu.Lock()
	p := m.panes[m.active]
	m.mu.Unlock()
	p.emu.Write([]byte(help))
	m.triggerRender()
}

// --- Rendering ---

func (m *Mux) triggerRender() {
	select {
	case m.renderCh <- struct{}{}:
	default:
	}
}

func (m *Mux) renderLoop() {
	interval := time.Second / renderFPS
	var last time.Time
	for {
		select {
		case <-m.stopCh:
			return
		case <-m.renderCh:
			if elapsed := time.Since(last); elapsed < interval {
				time.Sleep(interval - elapsed)
			}
			last = time.Now()
			m.render()
		}
	}
}

func (m *Mux) render() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.panes) == 0 {
		return
	}

	pane := m.panes[m.active]
	showTab := !pane.emu.IsAltScreen()
	ph := m.rows
	if showTab {
		ph = m.rows - 1
	}

	var buf bytes.Buffer

	// Hide cursor, move home
	buf.WriteString("\x1b[?25l\x1b[H")

	// Render pane content using emulator's Render()
	content := pane.emu.Render()
	lines := strings.Split(content, "\n")

	for y := 0; y < ph; y++ {
		if y > 0 {
			buf.WriteString("\r\n")
		}
		if y < len(lines) {
			buf.WriteString(lines[y])
		}
		buf.WriteString("\x1b[K") // clear to EOL
	}

	// Tab bar
	if showTab {
		buf.WriteString("\r\n\x1b[0m")
		for i, p := range m.panes {
			if i == m.active {
				buf.WriteString("\x1b[7m") // reverse video
			}
			p.mu.Lock()
			act := ""
			if p.activity && i != m.active {
				act = "*"
			}
			p.mu.Unlock()

			label := fmt.Sprintf(" %d:%s%s ", p.id, p.name, act)
			buf.WriteString(label)

			if i == m.active {
				buf.WriteString("\x1b[0m")
			}
		}
		buf.WriteString("\x1b[K")
	}

	// Cursor position
	pos := pane.emu.CursorPosition()
	cy, cx := int(pos.Y), int(pos.X)
	if cy < ph && cy >= 0 && cx >= 0 {
		buf.WriteString(fmt.Sprintf("\x1b[%d;%dH", cy+1, cx+1))
	}

	// Show cursor
	buf.WriteString("\x1b[?25h")

	os.Stdout.Write(buf.Bytes())
}
