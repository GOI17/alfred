package main

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func nodeFixture(t *testing.T, body string) (string, string) {
	t.Helper()
	node, e := exec.LookPath("node")
	if e != nil {
		t.Skip("Node is needed for subprocess contract tests")
	}
	node, e = filepath.Abs(node)
	if e != nil {
		t.Fatal(e)
	}
	p := filepath.Join(t.TempDir(), "bridge.cjs")
	if e = os.WriteFile(p, []byte(body), 0600); e != nil {
		t.Fatal(e)
	}
	return node, p
}
func TestBridgeRealJSONLSession(t *testing.T) {
	node, script := nodeFixture(t, `const rl=require('node:readline').createInterface({input:process.stdin});let token='';rl.on('line',line=>{const q=JSON.parse(line);let data;if(q.operation==='preview'){token='bound';data={text:'Actual proposed changes',previewToken:token};}else{if(q.previewToken!==token||q.confirmed!==true)process.exit(2);data={text:'Applied',status:'previews_only'};token='';}process.stdout.write(JSON.stringify({schema:q.schema,id:q.id,ok:true,data})+'\n');});`)
	b, e := startBridge(context.Background(), node, script)
	if e != nil {
		t.Fatal(e)
	}
	defer b.Close()
	s := readyModel().selection
	r, e := b.Call("preview", &s, "")
	if e != nil || r.Token != "bound" {
		t.Fatalf("%+v %v", r, e)
	}
	r, e = b.Call("apply", &s, r.Token)
	if e != nil || r.Text != "Applied" {
		t.Fatalf("%+v %v", r, e)
	}
}
func TestBridgeRejectsUntrustedEnvelopes(t *testing.T) {
	for _, reply := range []string{`{schema:q.schema,id:'wrong',ok:true,data:{text:'x',previewToken:'t'}}`, `{schema:q.schema,id:q.id,ok:true,data:{text:'x',previewToken:'t',unknown:1}}`, `{schema:q.schema,id:q.id,data:{text:'x',previewToken:'t'}}`, `{schema:'wrong',id:q.id,ok:true,data:{text:'x',previewToken:'t'}}`, `{schema:q.schema,id:q.id,ok:true,data:{text:'x',previewToken:''}}`} {
		t.Run(reply, func(t *testing.T) {
			node, script := nodeFixture(t, `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);process.stdout.write(JSON.stringify(`+reply+` )+'\n');});`)
			b, e := startBridge(context.Background(), node, script)
			if e != nil {
				t.Fatal(e)
			}
			defer b.Close()
			s := readyModel().selection
			if _, e = b.Call("preview", &s, ""); e == nil {
				t.Fatal("accepted invalid response")
			}
		})
	}
}
func TestBridgeCancellationTerminatesPendingRead(t *testing.T) {
	node, script := nodeFixture(t, `setInterval(()=>{},1000);`)
	ctx, cancel := context.WithCancel(context.Background())
	b, e := startBridge(ctx, node, script)
	if e != nil {
		t.Fatal(e)
	}
	done := make(chan error, 1)
	go func() { _, e := b.Call("discover", nil, ""); done <- e }()
	cancel()
	select {
	case e := <-done:
		if e == nil {
			t.Fatal("cancelled response succeeded")
		}
	case <-time.After(4 * time.Second):
		t.Fatal("read blocked after cancel")
	}
	b.Close()
}
func TestStrictDataAndDefaults(t *testing.T) {
	var d discovery
	if decodeStrict([]byte(`{} {}`), &d) == nil {
		t.Fatal("trailing data accepted")
	}
	if validateDiscovery(d) == nil {
		t.Fatal("empty defaults accepted")
	}
	if !strings.Contains(safeText("a\u2066b\u202ec界"), "abc界") {
		t.Fatal("bidi not sanitized")
	}
}

func TestBridgeActivationConfirmationAndStructuredResult(t *testing.T) {
	node, script := nodeFixture(t, `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.operation!=='activate'||q.confirmed!==true||q.previewToken!=='reviewed')process.exit(2);process.stdout.write(JSON.stringify({schema:q.schema,id:q.id,ok:true,data:{text:'Verified; start a new session',status:'activation_verified',traceEvents:[{provider_calls:0}]}})+'\n');});`)
	b, e := startBridge(context.Background(), node, script)
	if e != nil {
		t.Fatal(e)
	}
	defer b.Close()
	s := readyModel().selection
	r, e := b.Call("activate", &s, "reviewed")
	if e != nil || r.Status != "activation_verified" {
		t.Fatalf("%+v %v", r, e)
	}
}
