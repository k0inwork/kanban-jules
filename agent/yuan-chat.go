// yuan-chat — interactive chat with YUAN agent via /#yuan filesystem.
//
// Runs inside v86 VM (Wanix). Communicates with yuaone (running in
// almostnode in the browser) through the YuanFS 9p mount:
//
//	/#yuan/in     — write message here
//	/#yuan/out    — read triggers agent.run(), returns response
//	/#yuan/status — read to check agent status
//
// Usage:
//
//	yuan-chat                    # interactive REPL
//	yuan-chat "fix the bug"     # one-shot message
//	yuan-chat -s                # show status
//
// Build for v86: GOOS=linux GOARCH=386 go build -o yuan-chat.386 yuan-chat.go
package main

import (
	"bufio"
	"flag"
	"fmt"
	"os"
	"strings"
)

const defaultYuanDir = "/#yuan"

func readFile(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(data)), nil
}

func showStatus(dir string) {
	status, err := readFile(dir + "/status")
	if err != nil {
		fmt.Printf("Status: unknown (%s)\n", err)
		return
	}
	fmt.Printf("Status: %s\n", status)
}

func sendMessage(dir, message string) {
	fmt.Printf(">>> %s\n", message)

	// Write message to /#yuan/in
	err := os.WriteFile(dir+"/in", []byte(message), 0644)
	if err != nil {
		fmt.Printf("Error writing to %s/in: %s\n", dir, err)
		return
	}

	// Read /#yuan/out — YuanFS triggers agent.run() and returns response
	fmt.Println("--- waiting for response ---")
	response, err := readFile(dir + "/out")
	if err != nil {
		fmt.Printf("Error reading %s/out: %s\n", dir, err)
		return
	}
	fmt.Println(response)
}

func interactive(dir string) {
	fmt.Println("YUAN Agent Chat (v86)")
	fmt.Println("=====================")
	fmt.Printf("YuanFS dir: %s\n", dir)
	fmt.Println("Type a message, press Enter. Commands: /status /quit /help")
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
			fmt.Println("Bye.")
			return
		case line == "/status":
			showStatus(dir)
		case line == "/help":
			fmt.Println("Commands: /status /quit /help")
			fmt.Println("Anything else is sent to the YUAN agent.")
		default:
			sendMessage(dir, line)
		}

		fmt.Println()
		fmt.Print("yuan> ")
	}
}

func main() {
	dir := flag.String("dir", defaultYuanDir, "YuanFS mount point")
	status := flag.Bool("s", false, "show agent status")
	flag.Parse()

	// Check mount
	if _, err := os.Stat(*dir); err != nil {
		fmt.Printf("ERROR: %s not accessible: %s\n", *dir, err)
		fmt.Println("Make sure YuanFS is mounted (boardVM.yuan configured in browser).")
		os.Exit(1)
	}

	if *status {
		showStatus(*dir)
		return
	}

	args := flag.Args()
	if len(args) > 0 {
		sendMessage(*dir, strings.Join(args, " "))
		return
	}

	interactive(*dir)
}
