<#
.SYNOPSIS
  Runs the selector auto-detector heuristics (editor / send / stop) directly in the
  OneClickPrompts content-script world of the current Chrome for Testing tab.

  No need to break a selector in settings first: this calls
  window.OneClickPromptsSelectorAutoDetectorBase.detect*() via CDP in the extension's
  isolated world and prints what each heuristic picked next to what the configured
  selectors resolve to.

.PARAMETER Url
  Optional. Navigate the CFT tab there first (e.g. https://chatgpt.com/). Otherwise
  the currently focused tab is used as-is.

.PARAMETER WithText
  Optional. Text to insert into the detected editor before running the send/stop
  heuristics (many sites hide the send button while the editor is empty). The text
  is removed afterwards.

.EXAMPLE
  .\tests\cft-heuristics-probe.ps1
  .\tests\cft-heuristics-probe.ps1 -Url https://chatgpt.com/ -WithText "probe"
#>
param(
    [string]$Url,
    [string]$WithText
)

$ErrorActionPreference = 'Stop'
$skillDir = Join-Path $env:USERPROFILE '.claude\skills\browser-harness-cft\scripts'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $skillDir 'Ensure-BrowserHarnessCft.ps1') | Out-Null

$urlJson = ($Url | ConvertTo-Json)
$textJson = ($WithText | ConvertTo-Json)

$code = @"
import json
URL = $urlJson
TEXT = $textJson

if URL:
    goto_url(URL); wait_for_load(20); wait(4)

# Locate the OneClickPrompts isolated world (content scripts run there, not in the page world).
drain_events()
cdp("Runtime.disable"); cdp("Runtime.enable"); wait(0.5)
ctx = None
# After an extension reload a tab keeps an orphaned OneClickPrompts world next to the live one.
for e in drain_events():
    if e.get("method") == "Runtime.executionContextCreated":
        c = e["params"]["context"]
        if c.get("name") == "OneClickPrompts" and c.get("auxData", {}).get("type") == "isolated":
            r = cdp("Runtime.evaluate", expression="typeof chrome?.runtime?.id === 'string'", contextId=c["id"], returnByValue=True)
            if r.get("result", {}).get("value") is True:
                ctx = c["id"]
if ctx is None:
    raise SystemExit("OneClickPrompts content script context not found on this tab (extension not injected here?)")

def ocp(expr):
    r = cdp("Runtime.evaluate", expression=expr, contextId=ctx, awaitPromise=True, returnByValue=True)
    if "exceptionDetails" in r:
        raise SystemExit("JS error: " + json.dumps(r["exceptionDetails"], indent=1))
    return r["result"].get("value")

DESCRIBE = '''
var d = el => {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const attrs = ['id','data-testid','aria-label','name','type'].map(a => el.getAttribute(a) ? a + '=' + JSON.stringify(el.getAttribute(a)) : null).filter(Boolean).join(' ');
  return el.tagName.toLowerCase() + (attrs ? '[' + attrs + ']' : '') + '  @(' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ')';
};
const configured = type => {
  try {
    const sels = window.InjectionTargetsOnWebsite?.selectors?.[type] || [];
    for (const s of sels) { const el = document.querySelector(s); if (el) return d(el) + '   <- ' + s; }
  } catch (e) { return 'err: ' + e.message; }
  return null;
};
'''

def run_probe(label):
    res = ocp('''(async () => { %s
      // Same resolution as triggerRecovery: site-specific heuristics when registered, else base.
      const site = window.InjectionTargetsOnWebsite?.activeSite || 'Unknown';
      const Base = window.OneClickPromptsSelectorAutoDetectorBase;
      const H = window.OneClickPromptsSiteHeuristics?.resolve?.(site) || Base;
      const detectStop = typeof H.detectStopButton === 'function' ? H.detectStopButton : Base.detectStopButton;
      return {
        site, custom: H !== Base,
        editor: { heuristic: d(await H.detectEditor({ site })), configured: configured('editors') },
        send:   { heuristic: d(await H.detectSendButton({ site })), configured: configured('sendButtons') },
        stop:   { heuristic: d(await detectStop.call(Base, { site })), configured: configured('stopButtons') },
      };
    })()''' % DESCRIBE)
    print("=== %s  (%s)  site=%s heuristics=%s" % (label, page_info()["url"], res["site"], "site-specific" if res["custom"] else "base"))
    for k in ("editor", "send", "stop"):
        h, c = res[k]["heuristic"], res[k]["configured"]
        flag = "OK " if (h and c and h == c.split("   <- ")[0]) else ("?? " if h else "-- ")
        print("  %s %-7s heuristic : %s" % (flag, k, h))
        print("     %-7s configured: %s" % ("", c))

run_probe("empty editor")

if TEXT:
    focused = ocp('''(async () => { const el = await window.OneClickPromptsSelectorAutoDetectorBase.detectEditor(); if (!el) return false; el.focus(); return true; })()''')
    if focused:
        cdp("Input.insertText", text=TEXT); wait(1)
        run_probe("with text %r" % TEXT)
        press_key("a", 2); press_key("Backspace")
    else:
        print("(no editor found; skipping with-text probe)")
"@

& (Join-Path $skillDir 'Invoke-BrowserHarnessCft.ps1') -Code $code
