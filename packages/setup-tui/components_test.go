package main

import (
	"reflect"
	"testing"
)

func TestLegacyComponentsDoNotSelectWorkspace(t *testing.T) {
	for edition, want := range map[string][]string{"coding": {"harness"}, "memory": {"memory"}, "full": {"memory", "harness"}} {
		got := selectedComponents(selection{Edition: edition})
		if !reflect.DeepEqual(got, want) {
			t.Fatalf("%s: %v", edition, got)
		}
	}
}
func TestEveryComponentCombinationRoutesOnlySelectedCapabilities(t *testing.T) {
	for mask := 1; mask < 8; mask++ {
		m := readyModel()
		m.selection.Components = []string{}
		for i, c := range componentIDs {
			if mask&(1<<i) != 0 {
				m.selection.Components = append(m.selection.Components, c)
			}
		}
		m.selection.Harnesses = []string{"codex-cli"}
		m.selection.Memory = "local-sqlite"
		m, cmd := key(m, "enter")
		if cmd != nil {
			t.Fatal("selection performed work before review")
		}
		want := nameScreen
		if hasComponent(m.selection, "memory") {
			want = memoryScreen
		}
		if hasComponent(m.selection, "harness") {
			want = harnessScreen
		}
		if m.screen != want {
			t.Fatalf("mask %d: screen %d want %d", mask, m.screen, want)
		}
		if !hasComponent(m.selection, "harness") && (m.selection.Profiles || len(m.selection.Harnesses) != 0) {
			t.Fatalf("mask %d implicitly configured Harness", mask)
		}
		if !hasComponent(m.selection, "memory") && m.selection.Memory != "decide-later" {
			t.Fatalf("mask %d implicitly configured Memory", mask)
		}
	}
}
func TestWorkspaceSkipsProfilesAndRequiresExplicitComponent(t *testing.T) {
	m := readyModel()
	m.selection.Components = []string{}
	m, cmd := key(m, "enter")
	if m.screen != editionScreen || cmd != nil {
		t.Fatal("empty selection progressed")
	}
	m.cursor = 0
	m, _ = key(m, " ")
	if !reflect.DeepEqual(m.selection.Components, []string{"workspace"}) {
		t.Fatal(m.selection.Components)
	}
	m, _ = key(m, "enter")
	if m.screen != nameScreen {
		t.Fatal(m.screen)
	}
	m, _ = key(m, "enter")
	m.packaged = true
	m, cmd = key(m, "enter")
	if m.screen != loading || cmd == nil || m.selection.Profiles {
		t.Fatal("Workspace did not skip profile setup")
	}
	cmd()
	b := m.backend.(*fakeBackend)
	if len(b.calls) != 1 || b.calls[0] != "preview" {
		t.Fatal(b.calls)
	}
}
func TestComponentChoiceDoesNotReplaceSavedIntegrationUpdate(t *testing.T) {
	m := readyModel()
	integration := m.selection
	integration.Harnesses = []string{"codex-cli"}
	defaults := m.selection
	defaults.Components = []string{"workspace"}
	defaults.Edition = "workspace"
	defaults.Harnesses = []string{}
	next, _ := m.Update(replyMsg{operation: "discover", result: result{Discover: discovery{Version: "1.1.0", Defaults: defaults, IntegrationDefaults: &integration, Project: projectStatus{Status: "managed", Text: "Managed", CanUpdate: true}}}})
	m = next.(model)
	if !reflect.DeepEqual(m.selection.Components, []string{"workspace"}) || !reflect.DeepEqual(m.updateSelection.Harnesses, []string{"codex-cli"}) {
		t.Fatal("product preferences replaced update choices")
	}
}
func TestQueuedComponentSelectionIsCopied(t *testing.T) {
	m := readyModel()
	m.selection.Components = []string{"workspace"}
	cmd := m.call("preview")
	m.selection.Components[0] = "memory"
	cmd()
	if m.backend.(*fakeBackend).selections[0].Components[0] != "workspace" {
		t.Fatal("queued request selection changed")
	}
}
