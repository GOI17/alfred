package main

import (
	"bytes"
	"errors"
	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"io"
	"strings"
	"testing"
	"time"
)

type fakeBackend struct {
	calls      []string
	selections []selection
}

func (b *fakeBackend) Call(op string, s *selection, token string) (result, error) {
	b.calls = append(b.calls, op)
	if s != nil {
		b.selections = append(b.selections, *s)
	}
	return result{Text: "Real preview", Token: "test-token"}, nil
}
func readyModel() model {
	m := newModel(&fakeBackend{}, "/project")
	m.width = 80
	m.height = 24
	m.busy = false
	m.selection = selection{"coding", []string{}, "decide-later", "default", "/install", true}
	m.enter(editionScreen)
	return m
}
func key(m model, k string) (model, tea.Cmd) {
	var msg tea.KeyMsg
	switch k {
	case "enter":
		msg.Type = tea.KeyEnter
	case "esc":
		msg.Type = tea.KeyEsc
	case "ctrl+c":
		msg.Type = tea.KeyCtrlC
	case "backspace":
		msg.Type = tea.KeyBackspace
	case "end":
		msg.Type = tea.KeyEnd
	default:
		msg.Type = tea.KeyRunes
		msg.Runes = []rune(k)
	}
	next, cmd := m.Update(msg)
	return next.(model), cmd
}
func TestRepeatedEnterCannotApply(t *testing.T) {
	m := readyModel()
	m.screen = previewScreen
	m.output = "actual preview"
	m.token = "approval-token"
	for i := 0; i < 30; i++ {
		var cmd tea.Cmd
		m, cmd = key(m, "enter")
		if cmd != nil {
			t.Fatal("queued Enter executed command")
		}
	}
	if m.screen != confirmScreen {
		t.Fatal("expected safe confirmation")
	}
	for _, input := range []string{"yes", "yy", "y\r", "APPLY", "enter"} {
		var cmd tea.Cmd
		m, cmd = key(m, input)
		if cmd != nil {
			t.Fatalf("%q authorized apply", input)
		}
	}
	m, cmd := key(m, "y")
	if cmd == nil || !m.busy || m.token != "" {
		t.Fatal("explicit approval did not dispatch once")
	}
	cmd()
	b := m.backend.(*fakeBackend)
	if len(b.calls) != 1 || b.calls[0] != "apply" {
		t.Fatal(b.calls)
	}
	_, cmd = key(m, "enter")
	if cmd != nil {
		t.Fatal("duplicate apply")
	}
}
func TestLiteralTextAndUnicodeEditing(t *testing.T) {
	m := readyModel()
	m.enter(nameScreen)
	m.edit = nil
	m.position = 0
	for _, s := range []string{"j", "k", "q", "ñ", "界"} {
		m, _ = key(m, s)
	}
	if string(m.edit) != "jkqñ界" || m.quit {
		t.Fatal(string(m.edit))
	}
	m, _ = key(m, "backspace")
	m, _ = key(m, "enter")
	if m.selection.Name != "jkqñ" || m.screen != pathScreen {
		t.Fatal(m.selection.Name)
	}
}
func TestBackInvalidatesConsent(t *testing.T) {
	m := readyModel()
	m.screen = confirmScreen
	m.token = "old"
	m, _ = key(m, "esc")
	if m.token != "" || m.screen != profilesScreen {
		t.Fatal("approval survived back")
	}
}
func TestPreviewMustBeReadToEnd(t *testing.T) {
	m := readyModel()
	m.screen = previewScreen
	m.token = "t"
	m.output = strings.Repeat("change\n", 40)
	m, _ = key(m, "enter")
	if m.screen != previewScreen {
		t.Fatal("skipped hidden preview")
	}
	m, _ = key(m, "end")
	m, _ = key(m, "enter")
	if m.screen != confirmScreen {
		t.Fatal("cannot review")
	}
}
func TestGlobalCancellationAndSmallTerminal(t *testing.T) {
	for s := loading; s <= errorScreen; s++ {
		m := readyModel()
		m.screen = s
		m.busy = true
		m.width = 10
		m, cmd := key(m, "ctrl+c")
		if !m.quit || cmd == nil {
			t.Fatalf("screen %d did not cancel", s)
		}
	}
	m := readyModel()
	m.screen = confirmScreen
	m.token = "t"
	m.width = 20
	_, cmd := key(m, "y")
	if cmd != nil {
		t.Fatal("applied in unreadable terminal")
	}
}
func TestSnapshotBounds(t *testing.T) {
	for _, size := range [][2]int{{80, 24}, {40, 12}, {30, 10}} {
		for s := editionScreen; s <= errorScreen; s++ {
			m := readyModel()
			m.width = size[0]
			m.height = size[1]
			m.output = strings.Repeat("長い preview line and details\n", 30)
			m.enter(s)
			view := m.View()
			lines := strings.Split(view, "\n")
			if len(lines) > size[1] {
				t.Fatalf("%v screen%d height%d", size, s, len(lines))
			}
			for _, line := range lines {
				if lipgloss.Width(line) > size[0] {
					t.Fatalf("%v screen%d width%d", size, s, lipgloss.Width(line))
				}
			}
			if !strings.Contains(view, "Alfred setup") {
				t.Fatal("missing title")
			}
		}
	}
}
func TestSafeText(t *testing.T) {
	got := safeText("ok\x1b[31mRED\x1b[0m\x1b]52;c;secret\a\x00\u202eevil\n界")
	if got != "okREDevil\n界" {
		t.Fatalf("%q", got)
	}
}
func TestFilterRejectsBracketedPaste(t *testing.T) {
	for _, s := range []string{"\x1b[200~y\x1b[201~", "\x1b[200~y\r\x1b[201~", "\x1b[200~APPLY\r\x1b[201~", "\x1b[200~y"} {
		var out bytes.Buffer
		err := filterInput(strings.NewReader(s), &out)
		if !errors.Is(err, io.EOF) || out.Len() != 0 {
			t.Fatalf("%q %v", out.String(), err)
		}
	}
}
func TestFilterPreservesNormalKeysAndEscape(t *testing.T) {
	var out bytes.Buffer
	_ = filterInput(strings.NewReader("jkq\x1b[A\x1b"), &out)
	if out.String() != "jkq\x1b[A\x1b" {
		t.Fatal(out.String())
	}
}
func TestStandaloneEscapeArrivesWithoutAnotherKey(t *testing.T) {
	in, w := io.Pipe()
	out, r := io.Pipe()
	defer in.Close()
	defer w.Close()
	defer out.Close()
	defer r.Close()
	go filterInput(in, r)
	go w.Write([]byte{27})
	done := make(chan byte, 1)
	go func() { var b [1]byte; out.Read(b[:]); done <- b[0] }()
	select {
	case b := <-done:
		if b != 27 {
			t.Fatal(b)
		}
	case <-time.After(time.Second):
		t.Fatal("Escape stuck waiting for next key")
	}
}
func TestCallCapturesSelection(t *testing.T) {
	m := readyModel()
	m.selection.Harnesses = []string{"pi"}
	cmd := m.call("preview")
	m.selection.Harnesses[0] = "codex-cli"
	cmd()
	if m.backend.(*fakeBackend).selections[0].Harnesses[0] != "pi" {
		t.Fatal("mutable request snapshot")
	}
}
func TestFailureNeverApplies(t *testing.T) {
	m := readyModel()
	next, _ := m.Update(replyMsg{operation: "preview", err: errors.New("preview failed")})
	m = next.(model)
	if m.screen != errorScreen || !m.failure {
		t.Fatal("failure not surfaced")
	}
	_, cmd := key(m, "enter")
	if cmd != nil {
		if _, ok := cmd().(tea.QuitMsg); !ok {
			t.Fatal("failure executed command")
		}
	}
}

func TestBackPreservesUnsubmittedText(t *testing.T) {
	m := readyModel()
	m.enter(nameScreen)
	m.edit = []rune("new name")
	m.position = len(m.edit)
	m, _ = key(m, "esc")
	m.enter(nameScreen)
	if string(m.edit) != "new name" {
		t.Fatal("back lost draft")
	}
}

type chunkWriter struct{ chunks [][]byte }

func (w *chunkWriter) Write(p []byte) (int, error) {
	w.chunks = append(w.chunks, append([]byte{}, p...))
	return len(p), nil
}
func TestInputPreservesKeyBoundaries(t *testing.T) {
	w := &chunkWriter{}
	_ = filterInput(strings.NewReader("\x1b[Bñ界APPLY"), w)
	if len(w.chunks) != 1 || string(w.chunks[0]) != "\x1b[Bñ界APPLY" {
		t.Fatalf("key bytes split: %q", w.chunks)
	}
}

func TestNegativeConfirmationReturnsWithoutApply(t *testing.T) {
	for _, input := range []string{"n", "esc"} {
		m := readyModel()
		m.screen = confirmScreen
		m.token = "reviewed"
		m, cmd := key(m, input)
		if cmd != nil || m.screen != profilesScreen || m.token != "" {
			t.Fatalf("%s did not safely return", input)
		}
	}
}
func TestConfirmationRejectsAltYAndMissingToken(t *testing.T) {
	m := readyModel()
	m.screen = confirmScreen
	m.token = "reviewed"
	_, cmd := m.Update(tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune{'y'}, Alt: true})
	if cmd != nil {
		t.Fatal("Alt+y approved")
	}
	m.token = ""
	_, cmd = key(m, "y")
	if cmd != nil {
		t.Fatal("approval without preview")
	}
}

func TestActivationRequiresSecondReviewAndExplicitConfirmation(t *testing.T) {
	m := readyModel()
	next, cmd := m.Update(replyMsg{operation: "apply", result: result{Text: "Exact project files", Token: "activation-token", Status: "activation_review"}})
	m = next.(model)
	if cmd != nil || m.screen != activationPreviewScreen || m.token == "" {
		t.Fatal("preparation claimed activation")
	}
	m, cmd = key(m, "y")
	if cmd != nil {
		t.Fatal("review screen allowed activation")
	}
	m, _ = key(m, "enter")
	if m.screen != activationConfirmScreen {
		t.Fatal("missing separate confirmation")
	}
	for _, k := range []string{"enter", "yes", "yy", "y\r"} {
		m, cmd = key(m, k)
		if cmd != nil {
			t.Fatal("unsafe confirmation", k)
		}
	}
	m, cmd = key(m, "y")
	if cmd == nil || m.token != "" {
		t.Fatal("activation not dispatched once")
	}
	cmd()
	if got := m.backend.(*fakeBackend).calls; len(got) != 1 || got[0] != "activate" {
		t.Fatal(got)
	}
	next, _ = m.Update(replyMsg{operation: "activate", result: result{Text: "Files verified. Start a new session.", Status: "activation_verified"}})
	m = next.(model)
	if m.screen != resultScreen || !strings.Contains(m.subtitle(), "new session") {
		t.Fatal("missing honest completion")
	}
}
func TestActivationDeclineAndFailureNeverClaimSuccess(t *testing.T) {
	for _, k := range []string{"n", "esc"} {
		m := readyModel()
		m.screen = activationConfirmScreen
		m.token = "reviewed"
		m, cmd := key(m, k)
		if cmd == nil || m.token != "" {
			t.Fatal("decline not dispatched")
		}
		cmd()
		if got := m.backend.(*fakeBackend).calls; len(got) != 1 || got[0] != "decline" {
			t.Fatal(got)
		}
		next, _ := m.Update(replyMsg{operation: "decline", result: result{Status: "activation_declined"}})
		if !strings.Contains(next.(model).subtitle(), "declined") {
			t.Fatal("decline hidden")
		}
	}
	for _, status := range []string{"activation_blocked", "activation_failed", "activation_partial"} {
		m := readyModel()
		next, _ := m.Update(replyMsg{operation: "activate", result: result{Status: status}})
		m = next.(model)
		if !m.failure || !strings.Contains(m.subtitle(), "not verified") {
			t.Fatal("failure claimed success", status)
		}
	}
}
