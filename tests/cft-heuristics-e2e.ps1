<#
.SYNOPSIS
  Full-cycle heuristics test in Chrome for Testing: breaks the send/stop selectors for a
  site, fires a real auto-send through the extension, lets the selector recovery run
  (heuristics -> picker toast -> dismiss -> auto-send clicks the found button), watches the
  stop button during generation, then restores the original selectors and settings.

  This actually SENDS a prompt to each site and creates a chat there.

.PARAMETER Sites
  Subset of: ChatGPT, Claude, Copilot, DeepSeek, AIStudio, Grok, Gemini, Perplexity.
  Default: all.

.PARAMETER Prompt
  Text to send. Default is a tiny "reply OK" prompt.

.PARAMETER KeepSelectors
  Do not break the selectors: run the normal auto-send path and report what the configured
  selectors resolved to and whether the stop button was seen during generation.

.EXAMPLE
  .\tests\cft-heuristics-e2e.ps1 -Sites ChatGPT,Claude
#>
param(
    [string[]]$Sites = @('ChatGPT', 'Claude', 'Copilot', 'DeepSeek', 'AIStudio', 'Grok', 'Gemini', 'Perplexity'),
    [string]$Prompt = 'OCP heuristics test. Reply with exactly: OK',
    # Keep the configured selectors intact: exercises the normal auto-send path (no heuristics).
    [switch]$KeepSelectors
)

$ErrorActionPreference = 'Stop'
$skillDir = Join-Path $env:USERPROFILE '.claude\skills\browser-harness-cft\scripts'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $skillDir 'Ensure-BrowserHarnessCft.ps1') | Out-Null

$sitesJson = ($Sites | ConvertTo-Json -Compress)
if (-not $sitesJson.StartsWith('[')) { $sitesJson = "[$sitesJson]" }
$promptJson = ($Prompt | ConvertTo-Json)
$keepPy = if ($KeepSelectors) { 'True' } else { 'False' }

$code = @"
import json, time
SITES = $sitesJson
PROMPT = $promptJson
KEEP = $keepPy
BAD = '#ocp-heuristics-e2e-invalid-selector'
URLS = {
    'ChatGPT': 'https://chatgpt.com/',
    'Claude': 'https://claude.ai/new',
    'Copilot': 'https://copilot.microsoft.com/',
    'DeepSeek': 'https://chat.deepseek.com/',
    'AIStudio': 'https://aistudio.google.com/prompts/new_chat',
    'Grok': 'https://grok.com/',
    'Gemini': 'https://gemini.google.com/app',
    'Perplexity': 'https://www.perplexity.ai/',
}

CTX = {'id': None}

def find_ctx(timeout=20):
    # After an extension reload a tab keeps an orphaned OneClickPrompts world (chrome.runtime gone)
    # next to the live one, so every candidate is checked for a working runtime.
    deadline = time.time() + timeout
    while time.time() < deadline:
        drain_events()
        cdp("Runtime.disable"); cdp("Runtime.enable"); wait(0.4)
        ids = [e["params"]["context"]["id"] for e in drain_events()
               if e.get("method") == "Runtime.executionContextCreated"
               and e["params"]["context"].get("name") == "OneClickPrompts"
               and e["params"]["context"].get("auxData", {}).get("type") == "isolated"]
        for cid in ids:
            try:
                r = cdp("Runtime.evaluate", expression="typeof chrome?.runtime?.id === 'string'", contextId=cid, returnByValue=True)
                if r.get("result", {}).get("value") is True:
                    CTX['id'] = cid; return cid
            except Exception:
                pass
        wait(1)
    return None

def ocp(expr, await_promise=True):
    r = cdp("Runtime.evaluate", expression=expr, contextId=CTX['id'], awaitPromise=await_promise, returnByValue=True)
    if "exceptionDetails" in r:
        raise RuntimeError("JS: " + (r["exceptionDetails"].get("exception", {}).get("description") or json.dumps(r["exceptionDetails"]))[:400])
    return r["result"].get("value")

def logs():
    # The harness forwards each consoleAPICalled event twice; dedupe on (timestamp, text).
    out, seen = [], set()
    for e in drain_events():
        if e.get("method") == "Runtime.consoleAPICalled":
            args = e["params"].get("args", [])
            txt = " ".join(str(a.get("value", a.get("description", ""))) for a in args)
            key = (e["params"].get("timestamp"), txt)
            if key in seen: continue
            seen.add(key)
            if "[SelectorAutoDetector]" in txt or "[auto-send]" in txt or "[buttons]" in txt:
                out.append(txt[:220])
    return out

DESCRIBE = '''
var d = el => { if (!el) return null; const r = el.getBoundingClientRect();
  const attrs = ['id','data-testid','aria-label','type'].map(a => el.getAttribute(a) ? a + '=' + JSON.stringify(el.getAttribute(a)) : null).filter(Boolean).join(' ');
  return el.tagName.toLowerCase() + (attrs ? '[' + attrs + ']' : '') + ' @(' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ')'; };
'''
MSG = "(m) => new Promise(res => chrome.runtime.sendMessage(m, r => res(r ?? null)))"

def poll(expr, timeout, every=0.5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        v = ocp(expr)
        if v: return v
        wait(every)
    return None

def load_site(site):
    goto_url(URLS[site]); wait_for_load(30); wait(3)
    if not find_ctx(): return False
    ok = poll("!!(window.InjectionTargetsOnWebsite?.selectors && window.processCustomSendButtonClick && window.OneClickPromptsSelectorAutoDetector?.settings?.loaded)", 20)
    return bool(ok)

results = {}
for site in SITES:
    print("\n" + "=" * 70 + "\n%s  ->  %s" % (site, URLS[site]))
    res = results[site] = {"site": site}
    backup = None; settings_backup = None; armed = False
    try:
        if not load_site(site):
            res["status"] = "extension not injected / page not ready"; print("  !!", res["status"]); continue
        active = ocp("window.InjectionTargetsOnWebsite.activeSite")
        if active != site:
            res["status"] = "activeSite=%s (redirect? login page?)" % active; print("  !!", res["status"]); continue

        editor = ocp(DESCRIBE + "(window.InjectionTargetsOnWebsite.selectors.editors.map(s => { try { return document.querySelector(s) } catch(e) { return null } }).filter(Boolean).map(d)[0] || null)")
        toolbar = ocp("!!document.querySelector('[id*=\"custom-buttons-container\"], #max-extension-floating-panel')")
        if not editor:
            res["status"] = "NOT LOGGED IN / no editor (toolbar=%s) — log in and re-run" % toolbar; print("  !!", res["status"])
            capture_screenshot(r"C:\Users\motys\AppData\Local\Temp\claude\ocp-e2e-%s.png" % site, max_dim=1000); continue
        print("  editor  :", editor, "| toolbar:", toolbar)

        if KEEP:
            print("  keeping configured selectors; normal path")
            print("  configured send:", ocp(DESCRIBE + "(window.InjectionTargetsOnWebsite.selectors.sendButtons.map(s => { try { return document.querySelector(s) } catch(e) { return null } }).filter(Boolean).map(d)[0] || null)"))
        else:
            # --- arm: back up custom selectors + settings, break send/stop, enable heuristics
            backup = ocp("(%s)({type:'getCustomSelectors', site:%s}).then(r => r?.selectors ?? null)" % (MSG, json.dumps(site)))
            settings_backup = ocp("(%s)({type:'getSelectorAutoDetectorSettings'}).then(r => r?.settings ?? null)" % MSG)
            broken = dict(backup or {}); broken["sendButtons"] = [BAD]; broken["stopButtons"] = [BAD]
            ocp("(%s)({type:'saveCustomSelectors', site:%s, selectors:%s})" % (MSG, json.dumps(site), json.dumps(broken)))
            new_settings = dict(settings_backup or {}); new_settings.update(enableSendButtonHeuristics=True, enableStopButtonHeuristics=True, enableEditorHeuristics=True)
            ocp("(%s)({type:'saveSelectorAutoDetectorSettings', settings:%s})" % (MSG, json.dumps(new_settings)))
            armed = True

            if not load_site(site):
                res["status"] = "reload failed"; continue
            sels = ocp("window.InjectionTargetsOnWebsite.selectors.sendButtons")
            assert sels == [BAD], "broken selector not applied: %r" % sels
            print("  armed   : sendButtons/stopButtons = %s, heuristics on" % BAD)
        drain_events()

        # --- fire a real auto-send through the extension's own click handler
        ocp("void window.processCustomSendButtonClick(new MouseEvent('click', {bubbles:true}), %s, true)" % json.dumps(PROMPT), await_promise=False)
        t0 = time.time()
        if KEEP:
            picker = None
        else:
            picker = poll(DESCRIBE + "(() => { const s = window.OneClickPromptsSelectorAutoDetector.activePickerSession; return s?.type === 'sendButton' ? d(s.selectedEl) : null })()", 25)
            res["send_heuristic"] = picker
            print("  send heuristic picked (%.1fs): %s" % (time.time() - t0, picker))
            if not picker:
                res["status"] = "send picker never opened"; print("  logs:", *logs(), sep="\n    "); continue
            wait(1)
            # Dismiss the picker toast -> auto-send resumes with the picked element
            dismissed = ocp("(() => { const b = [...document.querySelectorAll('#toastContainer .toast-action')].find(b => b.textContent.includes('Dismiss')); if (!b) return false; b.click(); return true })()")
            print("  dismissed picker:", dismissed)

        stop = poll(DESCRIBE + "d(window.ButtonsClickingShared.findStopButton())", 25, every=0.15)
        res["stop_seen"] = stop
        print("  stop button during generation: %s" % stop)
        stop_toast = poll("(() => { const t = [...document.querySelectorAll('#toastContainer .toast')].map(t => t.textContent.trim()).find(t => /stop button/i.test(t)); return t ? t.slice(0, 160) : null })()", 6)
        res["stop_toast"] = stop_toast
        print("  stop toast: %s" % stop_toast)
        # The prompt must appear OUTSIDE the editor (i.e. in the thread), otherwise it just sat there unsent.
        sent = poll("""(() => { const needle = %s; const eds = window.InjectionTargetsOnWebsite.selectors.editors.flatMap(s => { try { return [...document.querySelectorAll(s)] } catch (e) { return [] } });
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let n;
            while ((n = walker.nextNode())) { if (n.nodeValue.includes(needle) && !eds.some(e => e.contains(n)) && !n.parentElement.closest('#toastContainer, [id*="custom-buttons-container"]')) return true; }
            return false; })()""" % json.dumps(PROMPT[:30]), 15)
        res["prompt_in_thread"] = bool(sent)
        print("  prompt visible in thread:", bool(sent))
        # wait for generation to end
        poll("!window.ButtonsClickingShared.findStopButton()", 60)
        res["status"] = "OK" if ((picker or KEEP) and sent) else "PARTIAL"
        capture_screenshot(r"C:\Users\motys\AppData\Local\Temp\claude\ocp-e2e-%s.png" % site, max_dim=1200)
        res["logs"] = logs()
        print("  logs:", *res["logs"][:25], sep="\n    ")
    except Exception as ex:
        res["status"] = "ERROR: %s" % ex; print("  !!", res["status"])
    finally:
        # --- restore exactly what was there before
        try:
            if armed:
                # The content-script context can be orphaned by a navigation (chrome.runtime gone);
                # retry on a fresh context, re-opening the site if needed, so nothing broken is left behind.
                def restore():
                    ocp("(%s)({type:'saveCustomSelectors', site:%s, selectors:%s})" % (MSG, json.dumps(site), json.dumps(backup)))
                    ocp("(%s)({type:'saveSelectorAutoDetectorSettings', settings:%s})" % (MSG, json.dumps(settings_backup)))
                    left = ocp("(%s)({type:'getCustomSelectors', site:%s}).then(r => r?.selectors ?? null)" % (MSG, json.dumps(site)))
                    assert left == backup, "restore verification failed: %r" % (left,)
                for attempt in range(3):
                    try:
                        if attempt > 0:
                            goto_url(URLS[site]); wait_for_load(30); wait(2)
                        if attempt > 0 or CTX['id'] is None: find_ctx()
                        restore(); break
                    except Exception as ex:
                        if attempt == 2: raise
                        print("  restore attempt %d failed (%s); retrying on a fresh context" % (attempt + 1, str(ex)[:80]))
                print("  restored: custom selectors (%s) and heuristics settings" % ("kept" if backup else "cleared"))
        except Exception as ex:
            print("  !! RESTORE FAILED for %s: %s  (backup=%s)" % (site, ex, json.dumps(backup)))

print("\n" + "=" * 70 + "\nSUMMARY")
for site, r in results.items():
    print("  %-10s %-12s send=%s | stop=%s" % (site, r.get("status"), (r.get("send_heuristic") or "-")[:70], (r.get("stop_seen") or "-")[:60]))
"@

& (Join-Path $skillDir 'Invoke-BrowserHarnessCft.ps1') -Code $code
