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

func TestBridgeUpdateDiscoveryAndApprovalProtocol(t *testing.T) {
	node, script := nodeFixture(t, `
 require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
  const q=JSON.parse(line); let data;
  const approving=q.operation==='runtime-approve'||q.operation==='project-apply';
  if(approving!==Boolean(q.confirmed))process.exit(2);
  switch(q.operation){
   case 'discover':
    if(q.selection)process.exit(2);
    data={version:'1.1.0',defaults:{edition:'coding',harnesses:['codex-cli'],memory:'decide-later',name:'saved',path:'/runtime',profiles:false},capabilities:{platform:'darwin',arch:'arm64',node:'24',harnesses:{'codex-cli':'installed'}},packaged:true,project:{status:'managed',version:'1.0.1',text:'Project update available',canUpdate:true},resume:true};break;
   case 'check-update':
    if(q.selection||q.previewToken)process.exit(2);
    data={status:'available',text:'Upgrade available',currentVersion:'1.1.0',latestVersion:'1.2.0',canUpgrade:true};break;
   case 'runtime-preview':data={status:'runtime_review',text:'Upgrade Alfred',previewToken:'runtime-token'};break;
   case 'runtime-approve':
    if(q.previewToken!=='runtime-token')process.exit(2);
    data={status:'runtime_upgrade_approved',text:'Ready for launcher',traceEvents:[{provider_calls:0}]};break;
   case 'project-preview':data={status:'project_review',text:'Exact project files',previewToken:'project-token'};break;
   case 'project-apply':
    if(q.previewToken!=='project-token')process.exit(2);
    data={status:'project_verified',text:'Integration updated'};break;
   case 'project-decline':data={status:'project_declined',text:'No project writes'};break;
   default:process.exit(2);
  }
  process.stdout.write(JSON.stringify({schema:q.schema,id:q.id,ok:true,data})+'\n');
 });`)
	b, e := startBridge(context.Background(), node, script)
	if e != nil {
		t.Fatal(e)
	}
	defer b.Close()
	d, e := b.Call("discover", nil, "")
	if e != nil || !d.Discover.Resume || d.Discover.Project.Version != "1.0.1" || !d.Discover.Project.CanUpdate {
		t.Fatalf("%+v %v", d, e)
	}
	r, e := b.Call("check-update", nil, "")
	if e != nil || !r.Update.CanUpgrade || r.Update.LatestVersion != "1.2.0" {
		t.Fatalf("%+v %v", r, e)
	}
	s := d.Discover.Defaults
	for _, tc := range []struct{ op, token, status string }{
		{"runtime-preview", "", "runtime_review"},
		{"runtime-approve", "runtime-token", "runtime_upgrade_approved"},
		{"project-preview", "", "project_review"},
		{"project-apply", "project-token", "project_verified"},
		{"project-decline", "project-token", "project_declined"},
	} {
		r, e = b.Call(tc.op, &s, tc.token)
		if e != nil || r.Status != tc.status {
			t.Fatalf("%s: %+v %v", tc.op, r, e)
		}
	}
}
func TestBridgeRejectsInvalidUpdateStatesAndConsentTokens(t *testing.T) {
	for _, tc := range []struct{ op, data string }{
		{"check-update", `{status:'unavailable',text:'Offline',currentVersion:'1.1.0',latestVersion:'',canUpgrade:true}`},
		{"check-update", `{status:'available',text:'Upgrade',currentVersion:'1.1.0',latestVersion:'',canUpgrade:true}`},
		{"check-update", `{status:'available',text:'Upgrade',currentVersion:'1.1.0',latestVersion:'1.2.0',canUpgrade:true,command:'untrusted'}`},
		{"runtime-preview", `{status:'runtime_review',text:'Upgrade',previewToken:''}`},
		{"runtime-preview", `{status:'runtime_blocked',text:'Unsupported',previewToken:'unsafe'}`},
		{"runtime-approve", `{status:'runtime_upgrade_approved',text:'Approved',previewToken:'reusable'}`},
		{"project-preview", `{status:'project_current',text:'Current',previewToken:'unsafe'}`},
		{"project-apply", `{status:'project_review',text:'Still review',previewToken:'unsafe'}`},
		{"project-decline", `{status:'project_verified',text:'Wrong result'}`},
	} {
		t.Run(tc.op+tc.data, func(t *testing.T) {
			node, script := nodeFixture(t, `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);process.stdout.write(JSON.stringify({schema:q.schema,id:q.id,ok:true,data:`+tc.data+`})+'\n');});`)
			b, e := startBridge(context.Background(), node, script)
			if e != nil {
				t.Fatal(e)
			}
			defer b.Close()
			s := readyModel().selection
			if _, e = b.Call(tc.op, &s, ""); e == nil {
				t.Fatal("invalid update response accepted")
			}
		})
	}
}
