package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

// The parent provides a real, foreground PTY but never answers queries. Assert
// protocol bytes, not elapsed-time performance: any OSC/DSR query fails at once.
// This catches reintroducing tea.WithOutput(os.Stderr) / WithColorCache, unlike
// a bytes.Buffer test where termenv already skips queries because it is not a TTY.
func TestTerminalStartupWithoutQueries(t *testing.T) {
	if os.Getenv("ALFRED_TEST_TERMINAL_STARTUP") == "1" {
		output := setupTerminalOutput(os.Stderr)
		if output.TTY() != os.Stderr {
			t.Fatal("lost terminal descriptor used for resize")
		}
		if os.Getenv("NO_COLOR") != "" {
			if output.Profile != termenv.Ascii {
				t.Fatal("NO_COLOR was ignored")
			}
		} else if output.Profile != termenv.TrueColor {
			t.Fatal("lost truecolor fidelity")
		}
		if !lipgloss.HasDarkBackground() {
			t.Fatal("Darcula background changed")
		}
		_ = tea.NewProgram(newModel(nil, "/project"), tea.WithInput(nil), tea.WithOutput(output))
		m := readyModel()
		fmt.Fprintln(os.Stderr, m.View())
		fmt.Fprintln(os.Stderr, "STARTUP_OK")
		return
	}
	python, err := exec.LookPath("python3")
	if err != nil {
		t.Fatal("python3 is required for the silent PTY startup regression")
	}
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, noColor := range []string{"", "1"} {
		name := "truecolor"
		if noColor != "" {
			name = "NO_COLOR"
		}
		t.Run(name, func(t *testing.T) {
			command := exec.Command(python, "-c", silentPTYStartup, binary, noColor)
			output, err := command.CombinedOutput()
			if err != nil {
				t.Fatalf("silent PTY startup: %v\n%s", err, output)
			}
			if !bytes.Contains(output, []byte("STARTUP_OK")) {
				t.Fatal("startup did not complete")
			}
		})
	}
}

const silentPTYStartup = `
import os, pty, select, signal, sys, time
pid, fd = pty.fork()
if pid == 0:
    env = dict(os.environ)
    # This fixture models an interactive terminal, not CI output. termenv0.15.2
    # isTTY deliberately returns false for any nonempty CI, even with a real
    # PTY; CLICOLOR_FORCE would then select ANSI instead of truecolor. Isolate
    # that runner flag while keeping both explicit NO_COLOR cases unchanged.
    env.pop("CI", None)
    env.update(TERM="xterm-256color", COLORTERM="truecolor", CLICOLOR_FORCE="1",
               NO_COLOR=sys.argv[2], ALFRED_TEST_TERMINAL_STARTUP="1")
    os.execve(sys.argv[1], [sys.argv[1], "-test.run=^TestTerminalStartupWithoutQueries$"], env)
raw = bytearray()
finished = False
try:
    # Only a deadlock watchdog, not a performance assertion.
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if select.select([fd], [], [], .1)[0]:
            try:
                chunk = os.read(fd, 65536)
            except OSError:
                break
            if not chunk:
                break
            raw.extend(chunk)
            for query in (b"\x1b]10;?", b"\x1b]11;?", b"\x1b[6n"):
                assert query not in raw, "startup queried the silent terminal: " + repr(query)
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            finished = True
            assert os.waitstatus_to_exitcode(status) == 0, bytes(raw)
            break
    if not finished:
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            finished = True
            assert os.waitstatus_to_exitcode(status) == 0, bytes(raw)
    assert b"STARTUP_OK" in raw, "startup did not complete: " + repr(bytes(raw))
    assert b"Alfred setup" in raw and b"Coding" in raw, "menu missing"
    if sys.argv[2]:
        import re
        assert re.search(rb"\x1b\[[0-9;]*m", raw) is None, "NO_COLOR emitted styling"
    else:
        assert b"38;2;204;120;50" in raw, "Darcula orange lost truecolor fidelity"
        assert b"38;2;104;151;187" in raw, "Darcula blue lost truecolor fidelity"
    print("STARTUP_OK: silent terminal, no OSC/DSR queries")
finally:
    if not finished:
        try:
            os.kill(pid, signal.SIGKILL)
            os.waitpid(pid, 0)
        except ProcessLookupError:
            pass
    os.close(fd)
`
