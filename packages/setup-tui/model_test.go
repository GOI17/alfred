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
	tokens     []string
}

func (b *fakeBackend) Call(op string, s *selection, token string) (result, error) {
	b.calls = append(b.calls, op)
	b.tokens = append(b.tokens, token)
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
	m.selection = selection{nil, "coding", []string{}, "decide-later", "default", "/install", true}
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
		for s := startScreen; s <= errorScreen; s++ {
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

func TestConfirmationsKeepBothChoicesVisibleAtMinimumSize(t *testing.T) {
	for _, tc := range []struct {
		screen           screen
		approve, decline string
	}{
		{confirmScreen, "y Prepare", "n Back"},
		{activationConfirmScreen, "y Install", "n Keep previews"},
		{updateConfirmScreen, "y Update", "n Back"},
	} {
		m := readyModel()
		m.width, m.height = 30, 10
		m.enter(tc.screen)
		view := m.View()
		if !strings.Contains(view, tc.approve) || !strings.Contains(view, tc.decline) {
			t.Fatalf("screen %d hid a confirmation choice: %q", tc.screen, view)
		}
		if len(strings.Split(view, "\n")) > m.height {
			t.Fatalf("screen %d overflowed minimum terminal height", tc.screen)
		}
	}
}

func discoveredModel(project projectStatus, resume bool) (model, tea.Cmd) {
	m := readyModel()
	d := discovery{Version: "1.1.0", Defaults: m.selection, Project: project, Resume: resume, Packaged: true}
	next, cmd := m.Update(replyMsg{operation: "discover", result: result{Discover: d}})
	return next.(model), cmd
}
func TestStartupRendersBeforeCheckAndContinueStaysAvailable(t *testing.T) {
	m, check := discoveredModel(projectStatus{Status: "managed", Version: "1.0.1", Text: "Project integration can be updated.", CanUpdate: true}, false)
	if m.screen != startScreen || m.busy || !m.checking || check == nil {
		t.Fatal("discovery waited for network or skipped startup")
	}
	if m.cursor != 1 || !strings.Contains(m.View(), "1.1.0") || !strings.Contains(m.View(), "1.0.1") {
		t.Fatal("missing independent versions or safe default")
	}
	// Update must wait for the bounded check to choose the combined upgrade path.
	m.cursor = 0
	waiting, cmd := key(m, "enter")
	if cmd != nil || waiting.screen != startScreen {
		t.Fatal("started project-only update before version check")
	}
	m.cursor = 1
	m, cmd = key(m, "enter")
	if cmd != nil || m.screen != editionScreen {
		t.Fatal("network check blocked Continue")
	}
	check()
	b := m.backend.(*fakeBackend)
	if len(b.calls) != 1 || b.calls[0] != "check-update" || len(b.selections) != 0 {
		t.Fatal("check carried installation choices", b.calls)
	}
	next, cmd := m.Update(replyMsg{operation: "check-update", result: result{Update: updateStatus{Status: "available", CurrentVersion: "1.1.0", LatestVersion: "1.2.0", CanUpgrade: true}}})
	m = next.(model)
	if cmd != nil || m.screen != editionScreen || m.checking {
		t.Fatal("late check interrupted setup")
	}
	m, _ = key(m, "esc")
	if m.screen != startScreen || m.cursor != 1 {
		t.Fatal("cannot return safely to update menu")
	}
}
func TestLateUpdateCheckCannotReleaseOperationOrReplaceConsent(t *testing.T) {
	for _, checkError := range []error{nil, errors.New("offline")} {
		m := readyModel()
		m.screen, m.busy, m.checking = updateConfirmScreen, true, true
		m.token, m.output, m.updateMode = "reviewed", "Exact files", "project"
		next, cmd := m.Update(replyMsg{operation: "check-update", result: result{Update: updateStatus{Status: "current"}}, err: checkError})
		m = next.(model)
		if cmd != nil || !m.busy || m.token != "reviewed" || m.output != "Exact files" || m.screen != updateConfirmScreen || m.failure {
			t.Fatal("background check changed active operation")
		}
		_, cmd = key(m, "y")
		if cmd != nil {
			t.Fatal("late response enabled duplicate consent")
		}
	}
}
func TestProjectUpdateAvailableWhenCLIIsCurrentOrOffline(t *testing.T) {
	for _, state := range []string{"current", "unavailable", "unsupported", "pending"} {
		m, _ := discoveredModel(projectStatus{Status: "managed", Version: "1.0.1", CanUpdate: true}, false)
		m.checking = false
		m.update = updateStatus{Status: state}
		m.updateSelection.Harnesses = []string{"codex-cli"}
		m.selection.Harnesses = []string{"pi"} // Unsubmitted wizard edits are not update choices.
		m.cursor = 0
		m, cmd := key(m, "enter")
		if cmd == nil || !m.busy || m.updateMode != "project" {
			t.Fatal("local update unavailable", state)
		}
		cmd()
		b := m.backend.(*fakeBackend)
		if len(b.calls) != 1 || b.calls[0] != "project-preview" || b.selections[0].Harnesses[0] != "codex-cli" {
			t.Fatal(b.calls, b.selections)
		}
	}
}
func TestRuntimeUpgradeHasSeparateReviewAndSingleApproval(t *testing.T) {
	m, _ := discoveredModel(projectStatus{Status: "managed", CanUpdate: true}, false)
	m.checking = false
	m.update = updateStatus{Status: "available", CanUpgrade: true}
	m.cursor = 0
	m, cmd := key(m, "enter")
	if cmd == nil {
		t.Fatal("missing runtime preview")
	}
	cmd()
	b := m.backend.(*fakeBackend)
	if len(b.calls) != 1 || b.calls[0] != "runtime-preview" {
		t.Fatal(b.calls)
	}
	next, _ := m.Update(replyMsg{operation: "runtime-preview", result: result{Status: "runtime_review", Text: "Upgrade 1.1.0 to 1.2.0", Token: "runtime-review"}})
	m = next.(model)
	for i := 0; i < 20; i++ {
		m, cmd = key(m, "enter")
		if cmd != nil {
			t.Fatal("Enter authorized upgrade")
		}
	}
	if m.screen != updateConfirmScreen || modelExitCode(m) != 0 {
		t.Fatal("upgrade before confirmation")
	}
	for _, input := range []string{"yes", "yy", "y\r"} {
		m, cmd = key(m, input)
		if cmd != nil {
			t.Fatal("pasted approval accepted")
		}
	}
	m, cmd = key(m, "y")
	if cmd == nil || !m.busy || m.token != "" {
		t.Fatal("missing one-use approval")
	}
	cmd()
	if b.calls[1] != "runtime-approve" || b.tokens[1] != "runtime-review" {
		t.Fatal(b.calls, b.tokens)
	}
	_, cmd = key(m, "y")
	if cmd != nil {
		t.Fatal("repeated upgrade")
	}
	next, cmd = m.Update(replyMsg{operation: "runtime-approve", result: result{Status: "runtime_upgrade_approved"}})
	m = next.(model)
	if !m.quit || cmd == nil || modelExitCode(m) != runtimeUpgradeExitCode {
		t.Fatal("launcher handoff not requested")
	}
	if _, ok := cmd().(tea.QuitMsg); !ok {
		t.Fatal("terminal UI did not quit before Brew")
	}
}
func TestUpdateDeclineNeverSignalsRuntimeUpgrade(t *testing.T) {
	for _, mode := range []string{"runtime", "project"} {
		for _, input := range []string{"n", "esc"} {
			m := readyModel()
			m.screen, m.updateMode, m.token = updateConfirmScreen, mode, "reviewed"
			m, cmd := key(m, input)
			if m.token != "" || modelExitCode(m) != 0 {
				t.Fatal("decline kept consent")
			}
			if mode == "runtime" {
				if cmd != nil || m.screen != startScreen {
					t.Fatal("runtime decline executed something")
				}
			} else {
				if cmd == nil {
					t.Fatal("project decline not recorded")
				}
				cmd()
				if got := m.backend.(*fakeBackend).calls; len(got) != 1 || got[0] != "project-decline" {
					t.Fatal(got)
				}
				next, _ := m.Update(replyMsg{operation: "project-decline", result: result{Status: "project_declined"}})
				if next.(model).screen != startScreen {
					t.Fatal("decline did not return to choices")
				}
			}
		}
	}
}
func TestResumeOnlyPreviewsProjectAndChecksVersion(t *testing.T) {
	m, cmd := discoveredModel(projectStatus{Status: "managed", CanUpdate: true}, true)
	if cmd == nil || !m.busy || m.updateMode != "project" || m.token != "" {
		t.Fatal("bad resume state")
	}
	batch, ok := cmd().(tea.BatchMsg)
	if !ok || len(batch) != 2 {
		t.Fatal("resume did not schedule independent check and preview")
	}
	for _, call := range batch {
		call()
	}
	calls := m.backend.(*fakeBackend).calls
	if len(calls) != 2 || calls[0] != "check-update" || calls[1] != "project-preview" {
		t.Fatal("resume applied files", calls)
	}
	for _, canUpdate := range []bool{false} {
		m, cmd = discoveredModel(projectStatus{Status: "blocked", CanUpdate: canUpdate}, true)
		if m.screen != startScreen || m.busy || cmd == nil {
			t.Fatal("blocked resume bypassed start")
		}
	}
}
func TestProjectCompletionAndPartialFailureRemainDistinct(t *testing.T) {
	for _, status := range []string{"project_verified", "project_partial", "project_failed"} {
		m := readyModel()
		m.runtimeVersion = "1.2.0"
		m.installedProject.Version = "1.1.0"
		next, _ := m.Update(replyMsg{operation: "project-apply", result: result{Status: status, Text: "Project result"}})
		m = next.(model)
		if m.screen != resultScreen {
			t.Fatal("project result missing")
		}
		if status == "project_verified" {
			if m.failure || m.installedProject.Version != "1.2.0" || !strings.Contains(m.subtitle(), "new session") {
				t.Fatal("verified state missing")
			}
		} else if !m.failure || m.installedProject.Version != "1.1.0" || modelExitCode(m) != 1 {
			t.Fatal("partial update advanced integration version")
		}
	}
}
func TestCancelledStartupIgnoresLateUpgradeReply(t *testing.T) {
	m, _ := discoveredModel(projectStatus{Status: "managed", CanUpdate: true}, false)
	m, _ = key(m, "ctrl+c")
	for _, reply := range []replyMsg{
		{operation: "check-update", result: result{Update: updateStatus{Status: "available", CanUpgrade: true}}},
		{operation: "runtime-approve", result: result{Status: "runtime_upgrade_approved"}},
	} {
		next, cmd := m.Update(reply)
		m = next.(model)
		if !m.quit || cmd != nil || m.runtimeUpgrade || modelExitCode(m) != 0 {
			t.Fatal("late response resumed cancelled update")
		}
	}
}
func TestStartupMinimumScreenShowsVersionsAndChoices(t *testing.T) {
	for _, state := range []string{"available", "current", "unavailable", "pending", "unsupported", "development"} {
		m, _ := discoveredModel(projectStatus{Status: "managed", Version: "1.0.1", Text: "Saved project", CanUpdate: true}, false)
		m.width, m.height, m.checking = 30, 10, false
		m.update = updateStatus{Status: state, LatestVersion: "1.2.0", CanUpgrade: state == "available"}
		view := m.View()
		for _, text := range []string{"CLI 1.1.0", "Project 1.0.1", "Update", "Continue setup"} {
			if !strings.Contains(view, text) {
				t.Fatalf("%s hid %s: %q", state, text, view)
			}
		}
		if state == "available" && !strings.Contains(view, "1.2.0") {
			t.Fatal("available version hidden")
		}
		if len(strings.Split(view, "\n")) > 10 {
			t.Fatal("startup overflowed height")
		}
		for _, line := range strings.Split(view, "\n") {
			if lipgloss.Width(line) > 30 {
				t.Fatal("startup overflowed width")
			}
		}
	}
}
