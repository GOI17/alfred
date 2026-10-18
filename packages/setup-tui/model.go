package main

import (
	"fmt"
	tea "github.com/charmbracelet/bubbletea"
	"strings"
	"unicode"
)

type screen int

const (
	loading screen = iota
	editionScreen
	harnessScreen
	memoryScreen
	nameScreen
	pathScreen
	profilesScreen
	previewScreen
	confirmScreen
	resultScreen
	errorScreen
)

var harnessIDs = []string{"opencode", "codex-cli", "codex-app", "pi"}

type replyMsg struct {
	operation string
	result    result
	err       error
}
type model struct {
	backend       backend
	screen        screen
	previous      screen
	selection     selection
	packaged      bool
	project       string
	cursor        int
	width, height int
	edit          []rune
	position      int
	token         string
	output        string
	offset        int
	busy          bool
	quit          bool
	failure       bool
	capabilities  map[string]string
}

func newModel(b backend, project string) model {
	return model{backend: b, screen: loading, project: project, busy: true}
}
func (m model) Init() tea.Cmd { return m.call("discover") }
func (m model) call(op string) tea.Cmd {
	s := m.selection
	s.Harnesses = append([]string{}, m.selection.Harnesses...)
	token := m.token
	return func() tea.Msg {
		var ptr *selection
		if op != "discover" {
			ptr = &s
		}
		r, e := m.backend.Call(op, ptr, token)
		return replyMsg{op, r, e}
	}
}
func (m *model) enter(s screen) {
	m.screen = s
	m.cursor = 0
	m.offset = 0
	switch s {
	case editionScreen:
		m.cursor = indexOf([]string{"coding", "memory", "full"}, m.selection.Edition)
	case memoryScreen:
		m.cursor = indexOf([]string{"decide-later", "existing-tenant", "local-sqlite", "postgres"}, m.selection.Memory)
	case nameScreen:
		m.edit = []rune(m.selection.Name)
		m.position = len(m.edit)
	case pathScreen:
		m.edit = []rune(m.selection.Path)
		m.position = len(m.edit)
	case profilesScreen:
		if !m.selection.Profiles {
			m.cursor = 1
		}
	}
}
func indexOf(xs []string, s string) int {
	for i, x := range xs {
		if x == s {
			return i
		}
	}
	return 0
}
func (m model) small() bool { return m.width < 30 || m.height < 10 }
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch v := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = v.Width
		m.height = v.Height
		if m.offset > m.maxOffset() {
			m.offset = m.maxOffset()
		}
		return m, nil
	case replyMsg:
		m.busy = false
		if v.err != nil {
			m.failure = true
			m.output = safeText(v.err.Error())
			if v.operation == "apply" {
				m.output += "\nSome changes may already have been applied. Review them before retrying."
			}
			m.enter(errorScreen)
			return m, nil
		}
		switch v.operation {
		case "discover":
			m.selection = v.result.Discover.Defaults
			m.packaged = v.result.Discover.Packaged
			m.capabilities = v.result.Discover.Capabilities.Harnesses
			m.enter(editionScreen)
		case "preview":
			m.token = v.result.Token
			m.output = safeText(v.result.Text)
			m.enter(previewScreen)
		case "apply":
			m.token = ""
			m.output = safeText(v.result.Text)
			m.enter(resultScreen)
		}
		return m, nil
	case tea.KeyMsg:
		key := v.String()
		if key == "ctrl+c" || key == "ctrl+d" {
			m.quit = true
			return m, tea.Quit
		}
		if m.busy || m.small() {
			return m, nil
		}
		if key == "esc" {
			if m.screen == editionScreen || m.screen == resultScreen || m.screen == errorScreen {
				m.quit = true
				return m, tea.Quit
			}
			m.token = ""
			if m.screen == nameScreen {
				m.selection.Name = string(m.edit)
			}
			if m.screen == pathScreen && !m.packaged {
				m.selection.Path = string(m.edit)
			}
			switch m.screen {
			case harnessScreen:
				m.enter(editionScreen)
			case memoryScreen:
				if m.selection.Edition == "memory" {
					m.enter(editionScreen)
				} else {
					m.enter(harnessScreen)
				}
			case nameScreen:
				if m.selection.Edition == "coding" {
					m.enter(harnessScreen)
				} else {
					m.enter(memoryScreen)
				}
			case pathScreen:
				m.enter(nameScreen)
			case profilesScreen:
				m.enter(pathScreen)
			case previewScreen:
				m.enter(profilesScreen)
			case confirmScreen:
				// Returning requires a fresh preview; an abandoned token is never reused.
				m.enter(profilesScreen)
			}
			return m, nil
		}
		if m.screen == nameScreen || (m.screen == pathScreen && !m.packaged) {
			switch key {
			case "enter":
				value := string(m.edit)
				if strings.TrimSpace(value) == "" {
					return m, nil
				}
				if m.screen == nameScreen {
					m.selection.Name = value
					m.enter(pathScreen)
				} else {
					m.selection.Path = value
					m.enter(profilesScreen)
				}
			case "left":
				if m.position > 0 {
					m.position--
				}
			case "right":
				if m.position < len(m.edit) {
					m.position++
				}
			case "home", "ctrl+a":
				m.position = 0
			case "end", "ctrl+e":
				m.position = len(m.edit)
			case "ctrl+u":
				m.edit = nil
				m.position = 0
			case "backspace", "ctrl+h":
				if m.position > 0 {
					m.edit = append(m.edit[:m.position-1], m.edit[m.position:]...)
					m.position--
				}
			case "delete":
				if m.position < len(m.edit) {
					m.edit = append(m.edit[:m.position], m.edit[m.position+1:]...)
				}
			default:
				if v.Type == tea.KeyRunes && !v.Alt {
					for _, r := range v.Runes {
						if !unicode.IsControl(r) && !unicode.Is(unicode.Cf, r) && len(m.edit) < 4096 {
							m.edit = append(m.edit, 0)
							copy(m.edit[m.position+1:], m.edit[m.position:])
							m.edit[m.position] = r
							m.position++
						}
					}
				} else if v.Type == tea.KeySpace {
					m.edit = append(m.edit, 0)
					copy(m.edit[m.position+1:], m.edit[m.position:])
					m.edit[m.position] = ' '
					m.position++
				}
			}
			return m, nil
		}
		if m.screen == confirmScreen {
			// Only one explicit key can approve. Enter, Alt combinations and
			// multi-rune input cannot; bracketed paste is removed before parsing.
			if v.Type != tea.KeyRunes || v.Alt || len(v.Runes) != 1 {
				return m, nil
			}
			switch v.Runes[0] {
			case 'y':
				if m.token != "" {
					m.busy = true
					cmd := m.call("apply")
					m.token = ""
					return m, cmd
				}
			case 'n':
				m.token = ""
				m.enter(profilesScreen)
			}
			return m, nil
		}

		if key == "q" {
			m.quit = true
			return m, tea.Quit
		}
		if m.screen == previewScreen || m.screen == resultScreen || m.screen == errorScreen {
			switch key {
			case "down", "j":
				if m.offset < m.maxOffset() {
					m.offset++
				}
			case "up", "k":
				if m.offset > 0 {
					m.offset--
				}
			case "pgdown", " ":
				m.offset = min(m.maxOffset(), m.offset+m.bodyHeight())
			case "pgup":
				m.offset = max(0, m.offset-m.bodyHeight())
			case "end":
				m.offset = m.maxOffset()
			case "home":
				m.offset = 0
			case "enter":
				if m.screen == previewScreen && m.offset == m.maxOffset() {
					m.enter(confirmScreen)
				} else if m.screen == resultScreen || m.screen == errorScreen {
					m.quit = true
					return m, tea.Quit
				}
			}
			return m, nil
		}
		count := len(m.options())
		switch key {
		case "up", "k":
			if count > 0 {
				m.cursor = (m.cursor + count - 1) % count
			}
		case "down", "j":
			if count > 0 {
				m.cursor = (m.cursor + 1) % count
			}
		case " ":
			if m.screen == harnessScreen {
				m.toggleHarness()
			}
		case "enter":
			switch m.screen {
			case editionScreen:
				m.selection.Edition = []string{"coding", "memory", "full"}[m.cursor]
				if m.selection.Edition == "memory" {
					m.selection.Harnesses = []string{}
					m.enter(memoryScreen)
				} else {
					m.enter(harnessScreen)
				}
			case harnessScreen:
				if m.selection.Edition == "coding" {
					m.selection.Memory = "decide-later"
					m.enter(nameScreen)
				} else {
					m.enter(memoryScreen)
				}
			case memoryScreen:
				m.selection.Memory = []string{"decide-later", "existing-tenant", "local-sqlite", "postgres"}[m.cursor]
				m.enter(nameScreen)
			case nameScreen:
				m.enter(pathScreen)
			case pathScreen:
				m.enter(profilesScreen)
			case profilesScreen:
				m.selection.Profiles = m.cursor == 0
				m.token = ""
				m.busy = true
				m.screen = loading
				return m, m.call("preview")
			}
		}
	}
	return m, nil
}
func (m *model) toggleHarness() {
	h := harnessIDs[m.cursor]
	for i, v := range m.selection.Harnesses {
		if v == h {
			m.selection.Harnesses = append(m.selection.Harnesses[:i], m.selection.Harnesses[i+1:]...)
			return
		}
	}
	m.selection.Harnesses = append(m.selection.Harnesses, h)
}
func (m model) options() []string {
	switch m.screen {
	case editionScreen:
		return []string{"Coding", "Memory", "Full"}
	case harnessScreen:
		labels := []string{"opencode", "Codex CLI", "Codex app", "Pi"}
		for i, h := range harnessIDs {
			mark := "○"
			for _, s := range m.selection.Harnesses {
				if s == h {
					mark = "●"
				}
			}
			labels[i] = mark + " " + labels[i]
		}
		return labels
	case memoryScreen:
		return []string{"Decide later", "Existing tenant", "Local SQLite", "PostgreSQL"}
	case profilesScreen:
		return []string{"Include runtime profiles", "Skip runtime profiles"}
	}
	return nil
}
func (m model) subtitle() string {
	switch m.screen {
	case editionScreen:
		return "What should Alfred configure?"
	case harnessScreen:
		return "Choose your coding tools"
	case memoryScreen:
		return "Choose a memory connection"
	case nameScreen:
		return "Name this setup"
	case pathScreen:
		return "Installation location"
	case profilesScreen:
		return "Runtime profiles"
	case previewScreen:
		return "Review proposed changes"
	case confirmScreen:
		return "Apply these changes?"
	case resultScreen:
		return "Setup complete"
	case errorScreen:
		return "Setup could not finish"
	default:
		return "Preparing your setup…"
	}
}
func (m model) contextLine() string {
	switch m.screen {
	case editionScreen:
		return []string{"Agents and skills for your coding tools.", "Configure Alfred's persistent memory.", "Coding tools and persistent memory."}[m.cursor]
	case harnessScreen:
		return "Select with Space; Enter continues. None is OK."
	case memoryScreen:
		return "Connection details remain in your existing configuration."
	case nameScreen:
		return "A name to recognize this configuration."
	case pathScreen:
		if m.packaged {
			return "Shared Alfred installation · location is fixed."
		}
		return "Where Alfred will keep this installation."
	case profilesScreen:
		return "Preview comes next. Nothing has been applied."
	case confirmScreen:
		return "y applies reviewed changes. n or Esc goes back."
	case previewScreen:
		return fmt.Sprintf("Preview only · lines %d–%d of %d", m.offset+1, min(len(m.outputLines()), m.offset+m.bodyHeight()), len(m.outputLines()))
	}
	return ""
}
