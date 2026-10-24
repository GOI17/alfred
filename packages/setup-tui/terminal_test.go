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
		m, _ := discoveredModel(projectStatus{Status: "none", Text: "No project integration installed."}, false)
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
    assert b"Alfred setup" in raw and b"Continue setup" in raw, "menu missing"
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

// Exercise the actual run loop in a foreground PTY. The deliberately unfinished
// check proves that Continue/Cancel do not wait for a backend reply. A separate
// fixture drives reviewed approval through exit20 and terminal restoration.
func TestSetupRunLoopUpdateAndCancellation(t *testing.T) {
	if os.Getenv("ALFRED_TEST_SETUP_RUN") == "1" {
		os.Args = []string{"alfred-setup", "--backend-node", os.Getenv("ALFRED_TEST_BACKEND_NODE"), "--backend-script", os.Getenv("ALFRED_TEST_BACKEND_SCRIPT")}
		os.Exit(run())
	}
	python, e := exec.LookPath("python3")
	if e != nil {
		t.Fatal("python3 is required for setup PTY regression")
	}
	binary, e := os.Executable()
	if e != nil {
		t.Fatal(e)
	}
	for _, mode := range []string{"continue", "cancel", "upgrade"} {
		t.Run(mode, func(t *testing.T) {
			node, script := nodeFixture(t, `
    require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
     const q=JSON.parse(line);
     const reply=data=>process.stdout.write(JSON.stringify({schema:q.schema,id:q.id,ok:true,data})+'\n');
     if(q.operation==='discover')return reply({version:'1.1.0',defaults:{edition:'coding',harnesses:['codex-cli'],memory:'decide-later',name:'saved',path:'/runtime',profiles:false},capabilities:{platform:'test',arch:'test',node:'24',harnesses:{}},packaged:true,project:{status:'managed',version:'1.0.1',text:'Project update available',canUpdate:true},resume:false});
     if(q.operation==='check-update'){
      if(process.env.ALFRED_TEST_PTY_MODE!=='upgrade')return setTimeout(()=>{},60000);
      return reply({status:'available',text:'New stable release',currentVersion:'1.1.0',latestVersion:'1.2.0',canUpgrade:true});
     }
     if(q.operation==='runtime-preview')return reply({status:'runtime_review',text:'Upgrade Alfred 1.1.0 to 1.2.0\nReview this Homebrew action.',previewToken:'exact-runtime-review'});
     if(q.operation==='runtime-approve'&&q.confirmed===true&&q.previewToken==='exact-runtime-review')return reply({status:'runtime_upgrade_approved',text:'Approved launcher handoff'});
     process.exit(2);
    });`)
			out, e := exec.Command(python, "-c", setupRunPTY, binary, node, script, mode).CombinedOutput()
			if e != nil {
				t.Fatalf("setup PTY %s: %v\n%s", mode, e, out)
			}
			if !bytes.Contains(out, []byte("PTY_OK")) {
				t.Fatalf("setup PTY did not finish: %s", out)
			}
		})
	}
}

const setupRunPTY = `
import errno, fcntl, os, pty, select, signal, struct, sys, termios, time
mode = sys.argv[4]
ready_r, ready_w = os.pipe()
pid, fd = pty.fork()
if pid == 0:
    os.close(ready_w)
    os.read(ready_r, 1)
    os.close(ready_r)
    env = dict(os.environ)
    env.pop("CI", None)
    env.update(TERM="xterm-256color", COLORTERM="truecolor", ALFRED_TEST_SETUP_RUN="1",
               ALFRED_TEST_BACKEND_NODE=sys.argv[2], ALFRED_TEST_BACKEND_SCRIPT=sys.argv[3], ALFRED_TEST_PTY_MODE=mode)
    os.execve(sys.argv[1], [sys.argv[1], "-test.run=^TestSetupRunLoopUpdateAndCancellation$"], env)
os.close(ready_r)
original = termios.tcgetattr(fd)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))
os.write(ready_w, b"1")
os.close(ready_w)
raw, stage, status = bytearray(), 0, None
try:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if select.select([fd], [], [], .1)[0]:
            try: chunk = os.read(fd, 65536)
            except OSError as error:
                if error.errno != errno.EIO: raise
                chunk = b""
            raw.extend(chunk)
            for query in (b"\x1b]10;?", b"\x1b]11;?", b"\x1b[6n"):
                assert query not in raw, "setup queried terminal"
        if mode in ("continue", "cancel"):
            if stage == 0 and b"Continue setup" in raw and b"Checking" in raw:
                os.write(fd, b"\r" if mode == "continue" else b"\x03")
                stage = 1
            if mode == "continue" and stage == 1 and b"What should Alfred" in raw and b"Agent Harness" in raw:
                os.write(fd, b"\x03")
                stage = 2
        else:
            if stage == 0 and b"New version: 1.2.0" in raw and b"Continue setup" in raw:
                os.write(fd, b"\x1b[A\r")
                stage = 1
            if stage == 1 and b"Review Alfred upgrade" in raw:
                os.write(fd, b"\r")
                stage = 2
            if stage == 2 and b"Upgrade Alfred now?" in raw:
                os.write(fd, b"y")
                stage = 3
        done, result = os.waitpid(pid, os.WNOHANG)
        if done:
            status = result
            while select.select([fd], [], [], .1)[0]:
                try: chunk = os.read(fd, 65536)
                except OSError as error:
                    if error.errno != errno.EIO: raise
                    break
                if not chunk: break
                raw.extend(chunk)
            break
    assert status is not None, "setup PTY timed out: " + repr(bytes(raw))
    assert stage == {"cancel": 1, "continue": 2, "upgrade": 3}[mode], "flow did not complete: " + repr(bytes(raw))
    assert os.waitstatus_to_exitcode(status) == (20 if mode == "upgrade" else 0), repr(bytes(raw))
    assert termios.tcgetattr(fd) == original, "setup did not restore terminal attributes"
    assert b"\x1b[?1049h" in raw and b"\x1b[?1049l" in raw, "setup did not restore alternate screen"
    print("PTY_OK: " + mode)
finally:
    if status is None:
        try: os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError: pass
        os.waitpid(pid, 0)
    os.close(fd)
`
