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
	startScreen
	editionScreen
	harnessScreen
	memoryScreen
	nameScreen
	pathScreen
	profilesScreen
	previewScreen
	confirmScreen
	activationPreviewScreen
	activationConfirmScreen
	updatePreviewScreen
	updateConfirmScreen
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
	backend          backend
	screen           screen
	previous         screen
	selection        selection
	packaged         bool
	project          string
	cursor           int
	width, height    int
	edit             []rune
	position         int
	token            string
	output           string
	status           string
	offset           int
	busy             bool
	quit             bool
	failure          bool
	capabilities     map[string]string
	runtimeVersion   string
	installedProject projectStatus
	updateSelection  selection
	update           updateStatus
	checking         bool
	updateMode       string
	runtimeUpgrade   bool
}

func newModel(b backend, project string) model {
	return model{backend: b, screen: loading, project: project, busy: true}
}
func (m model) Init() tea.Cmd { return m.call("discover") }
func (m model) call(op string) tea.Cmd {
	s := m.selection
	if strings.HasPrefix(op, "runtime-") || strings.HasPrefix(op, "project-") {
		s = m.updateSelection
	}
	s.Harnesses = append([]string{}, s.Harnesses...)
	if s.Components != nil {
		s.Components = append([]string{}, s.Components...)
	}
	token := m.token
	return func() tea.Msg {
		var ptr *selection
		if op != "discover" && op != "check-update" {
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
	case startScreen:
		m.cursor = 1 // A late update check never changes the default Continue action.
	case editionScreen:
		m.selection.Components = selectedComponents(m.selection)
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
	if m.quit {
		return m, nil
	}
	switch v := msg.(type) {
	case tea.WindowSizeMsg:
		m.width = v.Width
		m.height = v.Height
		if m.offset > m.maxOffset() {
			m.offset = m.maxOffset()
		}
		return m, nil
	case replyMsg:
		// This reply may arrive during a preview/apply. It must not release that
		// operation's busy guard, change screens, or replace its approval token.
		if v.operation == "check-update" {
			m.checking = false
			if v.err != nil {
				m.update = updateStatus{Status: "unavailable", Text: "Could not check for updates. You can continue setup.", CurrentVersion: m.runtimeVersion}
			} else {
				m.update = v.result.Update
			}
			return m, nil
		}
		m.busy = false
		if v.err != nil {
			m.failure = true
			m.output = safeText(v.err.Error())
			if v.operation == "apply" || v.operation == "activate" || v.operation == "project-apply" {
				m.output += "\nSome changes may already have been applied. Review them before retrying."
			}
			m.enter(errorScreen)
			return m, nil
		}
		switch v.operation {
		case "discover":
			d := v.result.Discover
			m.selection = d.Defaults
			m.selection.Components = selectedComponents(d.Defaults)
			m.updateSelection = d.Defaults
			if d.IntegrationDefaults != nil {
				m.updateSelection = *d.IntegrationDefaults
			}
			m.updateSelection.Harnesses = append([]string{}, m.updateSelection.Harnesses...)
			if m.updateSelection.Components != nil {
				m.updateSelection.Components = append([]string{}, m.updateSelection.Components...)
			}
			m.packaged = d.Packaged
			m.capabilities = d.Capabilities.Harnesses
			m.runtimeVersion = d.Version
			m.installedProject = d.Project
			m.checking = true
			m.enter(startScreen)
			check := m.call("check-update")
			if d.Resume && d.Project.CanUpdate {
				m.updateMode = "project"
				m.busy = true
				m.screen = loading
				return m, tea.Batch(check, m.call("project-preview"))
			}
			return m, check
		case "runtime-preview", "project-preview":
			m.token = v.result.Token
			m.output = safeText(v.result.Text)
			if v.operation == "project-preview" && m.update.Status != "current" {
				m.output = "Project integration using CLI " + safeText(m.runtimeVersion) + ".\n" + safeText(m.update.Text) + "\n\n" + m.output
			}
			m.status = v.result.Status
			m.updateMode = strings.TrimSuffix(v.operation, "-preview")
			if v.result.Status == "runtime_review" || v.result.Status == "project_review" {
				m.enter(updatePreviewScreen)
			} else {
				m.failure = v.result.Status == "project_blocked" || v.result.Status == "runtime_blocked"
				m.enter(resultScreen)
			}
		case "runtime-approve":
			m.token = ""
			m.status = v.result.Status
			if v.result.Status == "runtime_upgrade_approved" {
				m.runtimeUpgrade = true
				m.quit = true
				return m, tea.Quit
			}
		case "project-apply":
			m.token = ""
			m.status = v.result.Status
			m.output = safeText(v.result.Text)
			m.failure = v.result.Status == "project_partial" || v.result.Status == "project_failed"
			if v.result.Status == "project_verified" {
				m.installedProject.Version = m.runtimeVersion
			}
			m.enter(resultScreen)
		case "project-decline":
			m.token = ""
			m.failure = false
			m.updateMode = ""
			m.enter(startScreen)
		case "preview":
			m.token = v.result.Token
			m.output = safeText(v.result.Text)
			m.enter(previewScreen)
		case "apply", "activate", "decline":
			m.token = ""
			m.output = safeText(v.result.Text)
			m.status = v.result.Status
			if v.result.Status == "activation_review" {
				m.token = v.result.Token
				m.enter(activationPreviewScreen)
			} else {
				m.failure = v.result.Status == "activation_failed" || v.result.Status == "activation_partial" || v.result.Status == "activation_blocked"
				m.enter(resultScreen)
			}
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
			if m.screen == updatePreviewScreen || m.screen == updateConfirmScreen {
				return m.declineUpdate()
			}
			if m.screen == activationPreviewScreen || m.screen == activationConfirmScreen {
				m.busy = true
				cmd := m.call("decline")
				m.token = ""
				return m, cmd
			}
			if m.screen == startScreen || m.screen == resultScreen || m.screen == errorScreen {
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
			case editionScreen:
				m.enter(startScreen)
			case harnessScreen:
				m.enter(editionScreen)
			case memoryScreen:
				if !hasComponent(m.selection, "harness") {
					m.enter(editionScreen)
				} else {
					m.enter(harnessScreen)
				}
			case nameScreen:
				if hasComponent(m.selection, "memory") {
					m.enter(memoryScreen)
				} else if hasComponent(m.selection, "harness") {
					m.enter(harnessScreen)
				} else {
					m.enter(editionScreen)
				}
			case pathScreen:
				m.enter(nameScreen)
			case profilesScreen:
				m.enter(pathScreen)
			case previewScreen:
				if hasComponent(m.selection, "harness") {
					m.enter(profilesScreen)
				} else {
					m.enter(pathScreen)
				}
			case confirmScreen:
				// Returning requires a fresh preview; an abandoned token is never reused.
				if hasComponent(m.selection, "harness") {
					m.enter(profilesScreen)
				} else {
					m.enter(pathScreen)
				}
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
					if !hasComponent(m.selection, "harness") {
						return m.previewComponents()
					}
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
		if m.screen == confirmScreen || m.screen == activationConfirmScreen || m.screen == updateConfirmScreen {
			// Only one explicit key can approve. Enter, Alt combinations and
			// multi-rune input cannot; bracketed paste is removed before parsing.
			if v.Type != tea.KeyRunes || v.Alt || len(v.Runes) != 1 {
				return m, nil
			}
			switch v.Runes[0] {
			case 'y':
				if m.token != "" {
					m.busy = true
					op := "apply"
					if m.screen == activationConfirmScreen {
						op = "activate"
					} else if m.screen == updateConfirmScreen {
						if m.updateMode == "runtime" {
							op = "runtime-approve"
						} else {
							op = "project-apply"
						}
					}
					cmd := m.call(op)
					m.token = ""
					return m, cmd
				}
			case 'n':
				if m.screen == updateConfirmScreen {
					return m.declineUpdate()
				}
				if m.screen == activationConfirmScreen {
					m.busy = true
					cmd := m.call("decline")
					m.token = ""
					return m, cmd
				}
				m.token = ""
				m.enter(profilesScreen)
			}
			return m, nil
		}

		if key == "q" {
			m.quit = true
			return m, tea.Quit
		}
		if m.screen == previewScreen || m.screen == activationPreviewScreen || m.screen == updatePreviewScreen || m.screen == resultScreen || m.screen == errorScreen {
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
				if (m.screen == previewScreen || m.screen == activationPreviewScreen || m.screen == updatePreviewScreen) && m.offset == m.maxOffset() {
					if m.screen == updatePreviewScreen {
						m.enter(updateConfirmScreen)
					} else if m.screen == activationPreviewScreen {
						m.enter(activationConfirmScreen)
					} else {
						m.enter(confirmScreen)
					}
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
			} else if m.screen == editionScreen {
				m.toggleComponent()
			}
		case "enter":
			switch m.screen {
			case startScreen:
				if m.cursor == 1 {
					m.enter(editionScreen)
					return m, nil
				}
				if m.checking {
					return m, nil
				}
				op := ""
				if m.update.CanUpgrade {
					m.updateMode, op = "runtime", "runtime-preview"
				} else if m.installedProject.CanUpdate {
					m.updateMode, op = "project", "project-preview"
				}
				if op != "" {
					m.token = ""
					m.failure = false
					m.busy = true
					m.screen = loading
					return m, m.call(op)
				}
			case editionScreen:
				if len(m.selection.Components) == 0 {
					return m, nil
				}
				m.selection.Edition = componentEdition(m.selection)
				if !hasComponent(m.selection, "harness") {
					m.selection.Harnesses = []string{}
					m.selection.Profiles = false
				}
				if !hasComponent(m.selection, "memory") {
					m.selection.Memory = "decide-later"
				}
				if hasComponent(m.selection, "harness") {
					m.enter(harnessScreen)
				} else if hasComponent(m.selection, "memory") {
					m.enter(memoryScreen)
				} else {
					m.enter(nameScreen)
				}
			case harnessScreen:
				if !hasComponent(m.selection, "memory") {
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
				if !hasComponent(m.selection, "harness") {
					return m.previewComponents()
				}
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
func (m model) declineUpdate() (model, tea.Cmd) {
	if m.updateMode == "project" && m.token != "" {
		m.busy = true
		cmd := m.call("project-decline")
		m.token = ""
		return m, cmd
	}
	m.token = ""
	m.updateMode = ""
	m.failure = false
	m.enter(startScreen)
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
	case startScreen:
		label := "Update"
		if m.checking {
			label = "Checking updates…"
		} else if !m.update.CanUpgrade && !m.installedProject.CanUpdate {
			if m.update.Status == "current" {
				label = "No updates available"
			} else {
				label = "Update unavailable"
			}
		}
		return []string{label, "Continue setup"}
	case editionScreen:
		labels := []string{"Workspace", "Memory", "Agent Harness"}
		for i, c := range componentIDs {
			mark := "○"
			if hasComponent(m.selection, c) {
				mark = "●"
			}
			labels[i] = mark + " " + labels[i]
		}
		return labels
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
	case startScreen:
		return "CLI " + safeText(m.runtimeVersion)
	case updatePreviewScreen:
		if m.updateMode == "runtime" {
			return "Review Alfred upgrade"
		}
		return "Review project update"
	case updateConfirmScreen:
		if m.updateMode == "runtime" {
			return "Upgrade Alfred now?"
		}
		return "Update these project files?"
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
		return "Prepare these previews?"
	case activationPreviewScreen:
		return "Review project harness installation"
	case activationConfirmScreen:
		return "Install these harness files?"
	case resultScreen:
		switch m.status {
		case "project_verified":
			return "Project updated · start a new session"
		case "project_current":
			return "Project is up to date"
		case "project_partial", "project_failed":
			return "Project update not complete"
		case "project_blocked":
			return "Project update needs attention"
		case "runtime_blocked":
			return "Alfred upgrade unavailable"
		case "activation_verified":
			return "Harness files verified · start a new session"
		case "activation_declined":
			return "Previews only · activation declined"
		case "activation_blocked", "activation_failed", "activation_partial":
			return "Harness activation not verified"
		default:
			return "Preparation complete · no harness activated"
		}
	case errorScreen:
		return "Setup could not finish"
	default:
		return "Preparing your setup…"
	}
}
func (m model) contextLine() string {
	switch m.screen {
	case startScreen:
		version := m.installedProject.Version
		label := "Project " + safeText(version)
		if version == "" {
			switch m.installedProject.Status {
			case "none":
				label = "Project not configured"
			case "blocked":
				label = "Project needs attention"
			default:
				label = "Project version unknown"
			}
		}
		if m.installedProject.CanUpdate {
			label += " · review update"
		}
		return label
	case updateConfirmScreen:
		if m.updateMode == "runtime" {
			return "Upgrade Alfred, then review this project's integration."
		}
		return "Apply only the reviewed project changes."
	case editionScreen:
		return "Space selects independent capabilities; choose one or more."
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
		return "y prepares previews. Live activation needs a separate approval."
	case activationConfirmScreen:
		return "y installs reviewed project files. n or Esc keeps previews only."
	case previewScreen, activationPreviewScreen, updatePreviewScreen:
		return fmt.Sprintf("Preview only · lines %d–%d of %d", m.offset+1, min(len(m.outputLines()), m.offset+m.bodyHeight()), len(m.outputLines()))
	}
	return ""
}

var componentIDs = []string{"workspace", "memory", "harness"}

func selectedComponents(s selection) []string {
	if s.Components != nil {
		return append([]string{}, s.Components...)
	}
	switch s.Edition {
	case "memory":
		return []string{"memory"}
	case "full":
		return []string{"memory", "harness"}
	case "workspace":
		return []string{"workspace"}
	default:
		return []string{"harness"}
	}
}
func hasComponent(s selection, component string) bool {
	for _, c := range selectedComponents(s) {
		if c == component {
			return true
		}
	}
	return false
}
func componentEdition(s selection) string {
	if hasComponent(s, "harness") {
		if hasComponent(s, "memory") {
			return "full"
		}
		return "coding"
	}
	if hasComponent(s, "memory") {
		return "memory"
	}
	return "workspace"
}
func (m *model) toggleComponent() {
	c := componentIDs[m.cursor]
	for i, v := range m.selection.Components {
		if v == c {
			m.selection.Components = append(m.selection.Components[:i], m.selection.Components[i+1:]...)
			return
		}
	}
	m.selection.Components = append(m.selection.Components, c)
}
func (m model) previewComponents() (model, tea.Cmd) {
	m.selection.Profiles = false
	m.token = ""
	m.busy = true
	m.screen = loading
	return m, m.call("preview")
}
