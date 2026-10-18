package main

import (
	"github.com/charmbracelet/lipgloss"
	"strings"
	"unicode"
)

var titleStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#CC7832")).Bold(true)
var focusStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#6897BB")).Bold(true)
var mutedStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#808080"))

// Drop entire ANSI CSI/OSC sequences, not merely their escape byte. Also reject
// invisible bidi/format controls so externally supplied paths cannot spoof UI.
func safeText(s string) string {
	var b strings.Builder
	state := 0
	for _, r := range s {
		switch state {
		case 1:
			if r == '[' {
				state = 2
			} else if r == ']' {
				state = 3
			} else {
				state = 0
			}
			continue
		case 2:
			if r >= 0x40 && r <= 0x7e {
				state = 0
			}
			continue
		case 3:
			if r == 7 {
				state = 0
			} else if r == 27 {
				state = 4
			}
			continue
		case 4:
			if r == '\\' {
				state = 0
			} else {
				state = 3
			}
			continue
		}
		if r == 27 {
			state = 1
			continue
		}
		if r == '\n' {
			b.WriteRune(r)
		} else if r == '\t' {
			b.WriteString("  ")
		} else if !unicode.IsControl(r) && !unicode.Is(unicode.Cf, r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}
func truncate(s string, width int) string {
	if width <= 0 {
		return ""
	}
	var b strings.Builder
	n := 0
	for _, r := range s {
		w := lipgloss.Width(string(r))
		if n+w > width {
			break
		}
		b.WriteRune(r)
		n += w
	}
	return b.String()
}
func wrap(s string, width int) []string {
	width = max(1, width)
	lines := []string{}
	for _, line := range strings.Split(safeText(s), "\n") {
		var b strings.Builder
		n := 0
		for _, r := range line {
			w := lipgloss.Width(string(r))
			if n+w > width && n > 0 {
				lines = append(lines, b.String())
				b.Reset()
				n = 0
			}
			b.WriteRune(r)
			n += w
		}
		lines = append(lines, b.String())
	}
	return lines
}
func (m model) margin() int {
	if m.width >= 60 && m.height >= 20 {
		return 4
	}
	return 2
}
func (m model) bodyWidth() int { return max(1, m.width-2*m.margin()) }
func (m model) bodyHeight() int {
	if m.height >= 20 {
		return max(1, m.height-11)
	}
	return max(1, m.height-7)
}
func (m model) outputLines() []string { return wrap(m.output, m.bodyWidth()) }
func (m model) maxOffset() int        { return max(0, len(m.outputLines())-m.bodyHeight()) }
func (m model) View() string {
	if m.quit {
		return ""
	}
	if m.width == 0 || m.height == 0 {
		return "Alfred setup"
	}
	if m.small() {
		return truncate("Alfred setup · enlarge terminal", m.width) + "\n" + truncate("Ctrl+C cancels", m.width)
	}
	margin := m.margin()
	width := m.bodyWidth()
	top := 1
	if m.height >= 20 {
		top = 2
	}
	lines := make([]string, top)
	lines = append(lines, titleStyle.Render("Alfred setup"))
	if m.height >= 20 {
		lines = append(lines, "")
	}
	lines = append(lines, truncate(m.subtitle(), width))
	if m.height >= 20 {
		lines = append(lines, "")
	}
	body := []string{}
	if m.busy {
		body = append(body, "Working…  Ctrl+C cancels")
	} else {
		switch m.screen {
		case nameScreen, pathScreen:
			if m.screen == pathScreen && m.packaged {
				body = append(body, wrap(m.selection.Path, width)...)
			} else {
				// Keep the insertion position visible when a path is wider than the screen.
				before := safeText(string(m.edit[:m.position]))
				after := safeText(string(m.edit[m.position:]))
				for lipgloss.Width(before) > width-4 {
					_, n := firstRune(before)
					before = before[n:]
				}
				body = append(body, focusStyle.Render(truncate("❯ "+before+"▏"+after, width)))
			}
			if m.screen == pathScreen && m.height >= 20 {
				body = append(body, "", truncate("Project: "+safeText(m.project), width))
			}
		case confirmScreen:
			body = append(body, truncate("Only the reviewed changes will be applied.", width), "", focusStyle.Render("y  Apply       n  Back"))
		case previewScreen, resultScreen, errorScreen:
			all := m.outputLines()
			end := min(len(all), m.offset+m.bodyHeight())
			body = append(body, all[m.offset:end]...)
		default:
			options := m.options()
			spacing := 1
			if m.height >= 20 {
				spacing = 2
			}
			capacity := max(1, m.bodyHeight()/spacing)
			start := max(0, m.cursor-capacity+1)
			for i := start; i < len(options) && i < start+capacity; i++ {
				prefix := "  "
				if i == m.cursor {
					prefix = "❯ "
				}
				line := truncate(prefix+options[i], width)
				if i == m.cursor {
					line = focusStyle.Render(line)
				}
				body = append(body, line)
				if spacing == 2 {
					body = append(body, "")
				}
			}
		}
	}
	if len(body) > m.bodyHeight() {
		body = body[:m.bodyHeight()]
	}
	lines = append(lines, body...)
	// Reserve contextual line plus bottom keyboard help at every supported size.
	for len(lines) < m.height-3 {
		lines = append(lines, "")
	}
	context := m.contextLine()
	if m.busy {
		context = ""
	}
	lines = append(lines, mutedStyle.Render(truncate(context, width)))
	help := "↑/↓ j/k choose · Enter next · Esc back · q quit"
	switch m.screen {
	case nameScreen, pathScreen:
		help = "Enter next · Esc back · Ctrl+C cancel"
	case harnessScreen:
		help = "↑/↓ choose · Space select · Enter next · Esc back"
	case previewScreen:
		help = "↑/↓ scroll · Enter review · Esc back · q quit"
	case confirmScreen:
		help = "y apply · n/Esc back · Ctrl+C cancel"
	case resultScreen, errorScreen:
		help = "↑/↓ scroll · Enter or q close"
	}
	if m.width < 60 {
		help = "↑↓/jk · Enter next · Esc back · ^C"
		switch m.screen {
		case nameScreen, pathScreen:
			help = "Enter next · Esc back · ^C cancel"
		case harnessScreen:
			help = "↑↓ · Space select · Enter · Esc"
		case previewScreen:
			help = "↑↓ scroll · Enter · Esc back · q"
		case confirmScreen:
			help = "y apply · n/Esc back · ^C cancel"
		case resultScreen, errorScreen:
			help = "↑↓ scroll · Enter or q close"
		}
	}
	if m.busy {
		help = "Ctrl+C cancel"
	}
	lines = append(lines, mutedStyle.Render(truncate(help, width)))
	for len(lines) < m.height {
		lines = append(lines, "")
	}
	if len(lines) > m.height {
		lines = lines[:m.height]
	}
	for i := range lines {
		lines[i] = strings.Repeat(" ", margin) + lines[i]
	}
	return lipgloss.NewStyle().Background(lipgloss.Color("#2B2B2B")).Foreground(lipgloss.Color("#A9B7C6")).Width(m.width).Height(m.height).Render(strings.Join(lines, "\n"))
}
func firstRune(s string) (rune, int) {
	for _, r := range s {
		return r, len(string(r))
	}
	return 0, 0
}
