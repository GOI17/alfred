package main

import (
	"io"

	"github.com/charmbracelet/lipgloss"
	"github.com/muesli/termenv"
)

// setupTerminalOutput preserves the real terminal descriptor for resize and
// environment-based color support (including NO_COLOR). Darcula has a known
// background, so no terminal color queries are needed.
func setupTerminalOutput(w io.Writer) *termenv.Output {
	output := termenv.NewOutput(w)
	renderer := lipgloss.DefaultRenderer()
	renderer.SetOutput(output)
	renderer.SetColorProfile(output.Profile)
	renderer.SetHasDarkBackground(true)
	// Bubble Tea 0.25 accepts this concrete output without adding WithColorCache.
	// Passing w directly would eagerly query OSC10/11, each with a five-second
	// timeout. Even WithColorCache(false) performs those queries in termenv0.15.2.
	return output
}
