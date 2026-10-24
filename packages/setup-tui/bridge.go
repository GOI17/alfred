package main

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"
)

const schema = "alfred.setup/v1"
const maxMessage = 1024 * 1024

type selection struct {
	Edition   string   `json:"edition"`
	Harnesses []string `json:"harnesses"`
	Memory    string   `json:"memory"`
	Name      string   `json:"name"`
	Path      string   `json:"path"`
	Profiles  bool     `json:"profiles"`
}
type projectStatus struct {
	Status    string `json:"status"`
	Version   string `json:"version"`
	Text      string `json:"text"`
	CanUpdate bool   `json:"canUpdate"`
}
type updateStatus struct {
	Status         string `json:"status"`
	Text           string `json:"text"`
	CurrentVersion string `json:"currentVersion"`
	LatestVersion  string `json:"latestVersion"`
	CanUpgrade     bool   `json:"canUpgrade"`
}
type discovery struct {
	Version      string    `json:"version"`
	Defaults     selection `json:"defaults"`
	Capabilities struct {
		Platform  string            `json:"platform"`
		Arch      string            `json:"arch"`
		Node      string            `json:"node"`
		Harnesses map[string]string `json:"harnesses"`
	} `json:"capabilities"`
	Packaged bool          `json:"packaged"`
	Project  projectStatus `json:"project"`
	Resume   bool          `json:"resume"`
}
type request struct {
	Schema       string     `json:"schema"`
	ID           string     `json:"id"`
	Operation    string     `json:"operation"`
	Selection    *selection `json:"selection,omitempty"`
	PreviewToken string     `json:"previewToken,omitempty"`
	Confirmed    bool       `json:"confirmed,omitempty"`
}
type response struct {
	Schema string          `json:"schema"`
	ID     string          `json:"id"`
	OK     *bool           `json:"ok"`
	Data   json.RawMessage `json:"data,omitempty"`
	Error  *struct {
		Code    string `json:"code"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}
type result struct {
	Discover discovery
	Update   updateStatus
	Text     string
	Token    string
	Status   string
}
type backend interface {
	Call(string, *selection, string) (result, error)
}
type processBridge struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	cancel   context.CancelFunc
	input    io.WriteCloser
	output   *bufio.Scanner
	sequence uint64
}

func startBridge(ctx context.Context, node, script string) (*processBridge, error) {
	if !filepath.IsAbs(node) || !filepath.IsAbs(script) {
		return nil, errors.New("setup requires absolute executable paths")
	}
	ctx, cancel := context.WithCancel(ctx)
	cmd := exec.CommandContext(ctx, node, script)
	cmd.Cancel = func() error { return cmd.Process.Signal(syscall.SIGTERM) }
	cmd.WaitDelay = 3 * time.Second
	// Child diagnostics are intentionally not forwarded into the terminal.
	cmd.Stderr = io.Discard
	in, err := cmd.StdinPipe()
	if err != nil {
		cancel()
		return nil, err
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		in.Close()
		cancel()
		return nil, err
	}
	if err = cmd.Start(); err != nil {
		in.Close()
		cancel()
		return nil, errors.New("could not start setup; check the Alfred installation")
	}
	scanner := bufio.NewScanner(out)
	scanner.Buffer(make([]byte, 4096), maxMessage)
	return &processBridge{cmd: cmd, cancel: cancel, input: in, output: scanner}, nil
}
func (b *processBridge) Close() { b.input.Close(); b.cancel(); _ = b.cmd.Wait() }
func decodeStrict(data []byte, value any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	var extra any
	if d.Decode(&extra) != io.EOF {
		return errors.New("unexpected trailing data")
	}
	return nil
}
func (b *processBridge) Call(op string, s *selection, token string) (result, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	var r result
	b.sequence++
	req := request{Schema: schema, ID: fmt.Sprint(b.sequence), Operation: op, Selection: s, PreviewToken: token, Confirmed: op == "apply" || op == "activate" || op == "runtime-approve" || op == "project-apply"}
	data, err := json.Marshal(req)
	if err != nil || len(data) >= maxMessage {
		return r, errors.New("setup choices are too large")
	}
	if _, err = b.input.Write(append(data, '\n')); err != nil {
		return r, errors.New("setup stopped unexpectedly; restart Alfred setup")
	}
	if !b.output.Scan() {
		return r, errors.New("setup stopped unexpectedly; restart Alfred setup")
	}
	var resp response
	if decodeStrict(b.output.Bytes(), &resp) != nil || resp.Schema != schema || resp.ID != req.ID || resp.OK == nil {
		return r, errors.New("invalid setup response; update or reinstall Alfred")
	}
	if !*resp.OK {
		if resp.Error == nil || len(resp.Data) > 0 {
			return r, errors.New("invalid setup error response")
		}
		return r, errors.New(safeText(resp.Error.Message))
	}
	if resp.Error != nil || len(resp.Data) == 0 {
		return r, errors.New("incomplete setup response")
	}
	switch op {
	case "discover":
		err = decodeStrict(resp.Data, &r.Discover)
		if err == nil {
			err = validateDiscovery(r.Discover)
		}
	case "check-update":
		err = decodeStrict(resp.Data, &r.Update)
		if err == nil {
			err = validateUpdate(r.Update)
		}
	case "preview":
		var d struct {
			Text  string `json:"text"`
			Token string `json:"previewToken"`
		}
		err = decodeStrict(resp.Data, &d)
		r.Text, r.Token = d.Text, d.Token
		if d.Token == "" || d.Text == "" {
			err = errors.New("missing preview")
		}
	case "apply", "activate", "decline", "runtime-preview", "runtime-approve", "project-preview", "project-apply", "project-decline":
		var d struct {
			Text        string            `json:"text"`
			Token       string            `json:"previewToken,omitempty"`
			Status      string            `json:"status,omitempty"`
			TraceEvents []json.RawMessage `json:"traceEvents,omitempty"`
		}
		err = decodeStrict(resp.Data, &d)
		r.Text, r.Token, r.Status = d.Text, d.Token, d.Status
		validStatus := validOperationStatus(op, d.Status)
		review := d.Status == "activation_review" || d.Status == "runtime_review" || d.Status == "project_review"
		if !validStatus || d.Text == "" || (review && d.Token == "") || (!review && d.Token != "") {
			err = errors.New("invalid activation result")
		}
	default:
		err = errors.New("unknown operation")
	}
	if err != nil {
		return result{}, errors.New("invalid setup response; update or reinstall Alfred")
	}
	return r, nil
}
func validOperationStatus(op, status string) bool {
	switch op {
	case "apply":
		return status == "previews_only" || status == "activation_review" || status == "activation_blocked"
	case "activate":
		return status == "activation_verified" || status == "activation_failed" || status == "activation_partial"
	case "decline":
		return status == "activation_declined"
	case "runtime-preview":
		return status == "runtime_review" || status == "runtime_blocked"
	case "runtime-approve":
		return status == "runtime_upgrade_approved"
	case "project-preview":
		return status == "project_review" || status == "project_blocked" || status == "project_current"
	case "project-apply":
		return status == "project_verified" || status == "project_partial" || status == "project_failed"
	case "project-decline":
		return status == "project_declined"
	}
	return false
}
func validateUpdate(d updateStatus) error {
	switch d.Status {
	case "current", "available", "unavailable", "pending", "unsupported", "development":
	default:
		return errors.New("invalid update status")
	}
	if d.Text == "" || d.CurrentVersion == "" || (d.CanUpgrade && d.Status != "available") || (d.Status == "available" && d.LatestVersion == "") {
		return errors.New("incomplete update status")
	}
	return nil
}
func validateDiscovery(d discovery) error {
	switch d.Project.Status {
	case "none", "managed", "legacy", "blocked":
	default:
		return errors.New("invalid project status")
	}
	if d.Version == "" || d.Project.Text == "" || (d.Project.CanUpdate && (d.Project.Status == "none" || d.Project.Status == "blocked")) {
		return errors.New("incomplete discovery")
	}
	s := d.Defaults
	if s.Edition != "coding" && s.Edition != "memory" && s.Edition != "full" {
		return errors.New("invalid edition")
	}
	if s.Memory != "decide-later" && s.Memory != "existing-tenant" && s.Memory != "local-sqlite" && s.Memory != "postgres" {
		return errors.New("invalid memory")
	}
	if s.Name == "" || s.Path == "" || s.Harnesses == nil {
		return errors.New("incomplete defaults")
	}
	seen := map[string]bool{}
	for _, h := range s.Harnesses {
		if !knownHarness(h) || seen[h] {
			return errors.New("invalid harness")
		}
		seen[h] = true
	}
	for h, status := range d.Capabilities.Harnesses {
		if !knownHarness(h) || (status != "installed" && status != "not-installed") {
			return errors.New("invalid capabilities")
		}
	}
	return nil
}
func knownHarness(s string) bool {
	for _, h := range harnessIDs {
		if s == h {
			return true
		}
	}
	return false
}
