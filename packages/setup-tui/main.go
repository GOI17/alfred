package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	tea "github.com/charmbracelet/bubbletea"
	"golang.org/x/term"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"
	"unicode/utf8"
)

func main() { os.Exit(run()) }
func run() int {
	flags := flag.NewFlagSet("alfred-setup", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	version := flags.Bool("version", false, "show UI framework versions")
	node := flags.String("backend-node", "", "absolute Node executable")
	script := flags.String("backend-script", "", "absolute Alfred setup script")
	if flags.Parse(os.Args[1:]) != nil {
		return 2
	}
	if *version {
		fmt.Println("Alfred setup · Bubble Tea 0.25.0 · Lip Gloss 0.9.1")
		return 0
	}
	if flags.NArg() != 0 || *node == "" || *script == "" {
		fmt.Fprintln(os.Stderr, "Start this screen with alfred setup.")
		return 2
	}
	if !term.IsTerminal(int(os.Stdin.Fd())) || !term.IsTerminal(int(os.Stderr.Fd())) {
		fmt.Fprintln(os.Stderr, "Interactive setup requires a terminal. Use alfred setup --help for other options.")
		return 2
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	bridge, err := startBridge(ctx, *node, *script)
	if err != nil {
		fmt.Fprintln(os.Stderr, safeText(err.Error()))
		return 1
	}
	defer bridge.Close()
	original, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		fmt.Fprintln(os.Stderr, "Could not open the terminal.")
		return 1
	}
	defer term.Restore(int(os.Stdin.Fd()), original)
	// Bubble Tea 0.25 predates bracketed-paste support. Strip complete paste
	// frames before its parser; pasted text must never synthesize approval keys.
	reader, writer := io.Pipe()
	defer reader.Close()
	fmt.Fprint(os.Stderr, "\x1b[?2004h")
	defer fmt.Fprint(os.Stderr, "\x1b[?2004l")
	go func() { err := filterInput(os.Stdin, writer); writer.CloseWithError(err); cancel() }()
	project, _ := os.Getwd()
	p := tea.NewProgram(newModel(bridge, project), tea.WithInput(reader), tea.WithOutput(os.Stderr), tea.WithAltScreen(), tea.WithContext(ctx))
	final, err := p.Run()
	if err != nil && !errors.Is(err, tea.ErrProgramKilled) {
		fmt.Fprintln(os.Stderr, "Setup stopped. Run alfred setup to try again.")
		return 1
	}
	if m, ok := final.(model); ok && m.failure {
		return 1
	}
	return 0
}

// filterInput recognizes markers even when split across terminal reads. No
// speculative bytes escape until a possible marker is resolved.
func filterInput(in io.Reader, out io.Writer) error {
	start, end := "\x1b[200~", "\x1b[201~"
	pending := []byte{}
	carry := []byte{}
	pasting := false
	type chunk struct {
		data []byte
		err  error
	}
	chunks := make(chan chunk)
	done := make(chan struct{})
	defer close(done)
	go func() {
		for {
			buf := make([]byte, 256)
			n, err := in.Read(buf)
			select {
			case chunks <- chunk{buf[:n], err}:
			case <-done:
				return
			}
			if err != nil {
				return
			}
		}
	}()
	timer := time.NewTimer(time.Hour)
	defer timer.Stop()
	for {
		select {
		case <-timer.C:
			if !pasting && len(pending) > 0 {
				if _, e := out.Write(pending); e != nil {
					return e
				}
				pending = nil
			}
		case c := <-chunks:
			emitted := append([]byte{}, carry...)
			carry = nil
			for _, b := range c.data {
				pending = append(pending, b)
				marker := start
				if pasting {
					marker = end
				}
				for len(pending) > 0 && !isPrefix(pending, marker) {
					if !pasting {
						emitted = append(emitted, pending[0])
					}
					pending = pending[1:]
				}
				if string(pending) == marker {
					pasting = !pasting
					pending = nil
				}
			}
			// Preserve terminal read boundaries: splitting arrow sequences or
			// UTF-8 bytes into individual writes changes Bubble Tea key decoding.
			complete := 0
			for complete < len(emitted) && utf8.FullRune(emitted[complete:]) {
				_, n := utf8.DecodeRune(emitted[complete:])
				complete += n
			}
			carry = append(carry, emitted[complete:]...)
			if complete > 0 {
				if _, e := out.Write(emitted[:complete]); e != nil {
					return e
				}
			}
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(35 * time.Millisecond)
			if c.err != nil {
				if !pasting && len(pending) > 0 {
					if _, e := out.Write(pending); e != nil {
						return e
					}
				}
				return c.err
			}
		}
	}
}
func isPrefix(p []byte, s string) bool { return len(p) <= len(s) && string(p) == s[:len(p)] }
