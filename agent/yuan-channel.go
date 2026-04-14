// yuan-channel — interactive FS channel bridge for YUAN agent.
//
// Creates a set of filesystem channels that mirror the YuanFS pattern:
//
//	.yuan/in      → write a message to send to the agent
//	.yuan/out     → read to get the agent's response (blocks until ready)
//	.yuan/status  → read to get current status ("idle"|"running"|"error")
//	.yuan/tools   → read to list available tools
//	.yuan/llm/req → write an LLM request (OpenAI JSON format)
//	.yuan/llm/res → read the LLM response
//
// Usage:
//
//	go run yuan-channel.go [--dir .yuan] [--port 8099]
//
// The script watches .yuan/in for writes, sends them to the YUAN agent
// (via HTTP to the Fleet dev server or directly to the almostnode bridge),
// and writes responses to .yuan/out.
//
// Interactive mode:
//
//	echo "Fix the bug in main.go" > .yuan/in
//	cat .yuan/out      # blocks until response ready
//	cat .yuan/status   # "idle" | "running" | "error"
//
// This is the "bash-go script that makes FS channels interactive" —
// it turns the filesystem into a bidirectional communication channel
// for the YUAN agent, usable from any shell, script, or tool.
package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Channel holds the state of the FS channel bridge.
type Channel struct {
	dir     string
	baseURL string
	mu      sync.Mutex
	status  string
	lastOut string
}

// NewChannel creates and initializes the FS channel directory structure.
func NewChannel(dir, baseURL string) (*Channel, error) {
	ch := &Channel{
		dir:     dir,
		baseURL: baseURL,
		status:  "idle",
		lastOut: "no message sent yet",
	}

	// Create directory structure
	dirs := []string{
		dir,
		filepath.Join(dir, "llm"),
	}
	for _, d := range dirs {
		if err := os.MkdirAll(d, 0755); err != nil {
			return nil, fmt.Errorf("mkdir %s: %w", d, err)
		}
	}

	// Initialize channel files
	files := map[string]string{
		"status": "idle\n",
		"out":    "no message sent yet\n",
		"tools":  "[]\n",
	}
	for name, content := range files {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			return nil, fmt.Errorf("write %s: %w", path, err)
		}
	}

	// Create empty writable files
	for _, name := range []string{"in", "llm/req"} {
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte{}, 0644); err != nil {
			return nil, fmt.Errorf("write %s: %w", path, err)
		}
	}

	// Create empty LLM response file
	if err := os.WriteFile(filepath.Join(dir, "llm", "res"), []byte("{}\n"), 0644); err != nil {
		return nil, fmt.Errorf("write llm/res: %w", err)
	}

	return ch, nil
}

// updateStatus writes the current status to the status file.
func (ch *Channel) updateStatus(status string) {
	ch.mu.Lock()
	ch.status = status
	ch.mu.Unlock()

	path := filepath.Join(ch.dir, "status")
	_ = os.WriteFile(path, []byte(status+"\n"), 0644)
}

// writeOut writes the agent response to the out file.
func (ch *Channel) writeOut(response string) {
	ch.mu.Lock()
	ch.lastOut = response
	ch.mu.Unlock()

	path := filepath.Join(ch.dir, "out")
	_ = os.WriteFile(path, []byte(response+"\n"), 0644)
}

// sendToAgent sends a message to the YUAN agent via HTTP.
func (ch *Channel) sendToAgent(message string) (string, error) {
	payload := map[string]string{"message": message}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", fmt.Errorf("marshal: %w", err)
	}

	url := ch.baseURL + "/api/yuan/send"
	resp, err := http.Post(url, "application/json", strings.NewReader(string(body)))
	if err != nil {
		return "", fmt.Errorf("POST %s: %w", url, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("agent returned %d: %s", resp.StatusCode, string(respBody))
	}

	var result struct {
		Response string `json:"response"`
		Error    string `json:"error"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		// Non-JSON response — return raw text
		return string(respBody), nil
	}
	if result.Error != "" {
		return "", fmt.Errorf("agent error: %s", result.Error)
	}
	return result.Response, nil
}

// sendLLMRequest sends a raw LLM request via HTTP.
func (ch *Channel) sendLLMRequest(reqJSON string) (string, error) {
	url := ch.baseURL + "/api/yuan/llm"
	resp, err := http.Post(url, "application/json", strings.NewReader(reqJSON))
	if err != nil {
		return "", fmt.Errorf("POST %s: %w", url, err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read response: %w", err)
	}

	return string(respBody), nil
}

// watchInFile polls the "in" file for new messages.
func (ch *Channel) watchInFile() {
	inPath := filepath.Join(ch.dir, "in")
	var lastMod time.Time
	var lastSize int64

	for {
		info, err := os.Stat(inPath)
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}

		// Detect new write: file modified and non-empty
		if info.ModTime().After(lastMod) && info.Size() > 0 && info.Size() != lastSize {
			lastMod = info.ModTime()
			lastSize = info.Size()

			data, err := os.ReadFile(inPath)
			if err != nil || len(strings.TrimSpace(string(data))) == 0 {
				continue
			}

			message := strings.TrimSpace(string(data))
			log.Printf("[channel] received message: %s", truncate(message, 80))

			// Clear the in file
			_ = os.WriteFile(inPath, []byte{}, 0644)

			// Process the message
			ch.updateStatus("running")
			go func(msg string) {
				response, err := ch.sendToAgent(msg)
				if err != nil {
					log.Printf("[channel] error: %s", err)
					ch.updateStatus("error")
					ch.writeOut("ERROR: " + err.Error())
					return
				}

				log.Printf("[channel] response: %s", truncate(response, 80))
				ch.updateStatus("idle")
				ch.writeOut(response)
			}(message)
		}

		time.Sleep(200 * time.Millisecond)
	}
}

// watchLLMReqFile polls the "llm/req" file for new LLM requests.
func (ch *Channel) watchLLMReqFile() {
	reqPath := filepath.Join(ch.dir, "llm", "req")
	resPath := filepath.Join(ch.dir, "llm", "res")
	var lastMod time.Time
	var lastSize int64

	for {
		info, err := os.Stat(reqPath)
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}

		if info.ModTime().After(lastMod) && info.Size() > 0 && info.Size() != lastSize {
			lastMod = info.ModTime()
			lastSize = info.Size()

			data, err := os.ReadFile(reqPath)
			if err != nil || len(strings.TrimSpace(string(data))) == 0 {
				continue
			}

			reqJSON := strings.TrimSpace(string(data))
			_ = os.WriteFile(reqPath, []byte{}, 0644)

			go func(req string) {
				response, err := ch.sendLLMRequest(req)
				if err != nil {
					_ = os.WriteFile(resPath, []byte(`{"error":"`+err.Error()+`"}`+"\n"), 0644)
					return
				}
				_ = os.WriteFile(resPath, []byte(response+"\n"), 0644)
			}(reqJSON)
		}

		time.Sleep(200 * time.Millisecond)
	}
}

// interactiveMode runs an interactive REPL for sending messages.
func (ch *Channel) interactiveMode() {
	fmt.Println("YUAN Agent Interactive Channel")
	fmt.Println("==============================")
	fmt.Printf("Channel dir: %s\n", ch.dir)
	fmt.Printf("Server:      %s\n", ch.baseURL)
	fmt.Println()
	fmt.Println("Type a message and press Enter to send to the agent.")
	fmt.Println("Commands: /status, /tools, /quit")
	fmt.Println()

	scanner := bufio.NewScanner(os.Stdin)
	fmt.Print("yuan> ")

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			fmt.Print("yuan> ")
			continue
		}

		switch {
		case line == "/quit" || line == "/exit":
			fmt.Println("Goodbye.")
			return

		case line == "/status":
			ch.mu.Lock()
			fmt.Printf("Status: %s\n", ch.status)
			ch.mu.Unlock()

		case line == "/tools":
			data, err := os.ReadFile(filepath.Join(ch.dir, "tools"))
			if err != nil {
				fmt.Printf("Error reading tools: %s\n", err)
			} else {
				fmt.Println(string(data))
			}

		default:
			// Send message to agent
			ch.updateStatus("running")
			fmt.Println("Sending to agent...")

			response, err := ch.sendToAgent(line)
			if err != nil {
				fmt.Printf("Error: %s\n", err)
				ch.updateStatus("error")
			} else {
				ch.updateStatus("idle")
				ch.writeOut(response)
				fmt.Println()
				fmt.Println(response)
			}
		}

		fmt.Println()
		fmt.Print("yuan> ")
	}
}

func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

func main() {
	dir := flag.String("dir", ".yuan", "directory for FS channels")
	port := flag.String("port", "3000", "Fleet dev server port")
	host := flag.String("host", "localhost", "Fleet dev server host")
	interactive := flag.Bool("i", false, "run in interactive mode (REPL)")
	flag.Parse()

	baseURL := fmt.Sprintf("http://%s:%s", *host, *port)

	ch, err := NewChannel(*dir, baseURL)
	if err != nil {
		log.Fatalf("Failed to create channel: %v", err)
	}

	log.Printf("YUAN FS channels ready at %s", *dir)
	log.Printf("  echo 'your message' > %s/in", *dir)
	log.Printf("  cat %s/out", *dir)
	log.Printf("  cat %s/status", *dir)

	// Start file watchers
	go ch.watchInFile()
	go ch.watchLLMReqFile()

	if *interactive {
		ch.interactiveMode()
		return
	}

	// Wait for signal
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)

	log.Println("Watching for messages... (Ctrl+C to quit)")
	<-sigCh
	log.Println("Shutting down.")
}
