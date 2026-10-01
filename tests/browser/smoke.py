"""Workbench browser regression suite, NOT a zfb runtime test.

Default harness uses set_content because this container blocks every navigation URL.
SHA-256 calls bridge to Python hashlib only when about:blank lacks SubtleCrypto.
HTTP mode bridges browser fetch to the real loopback Node HTTP server. This does not
verify browser cookies, CORS, CSP, native SubtleCrypto, or normal navigation.
Set CONVOS_BROWSER_DIRECT=1 locally to exercise normal localhost navigation/native fetch.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import hashlib, json, os, socket, subprocess, tempfile, time, urllib.request, urllib.error
ROOT=Path(__file__).resolve().parents[2]
DIRECT=os.getenv('CONVOS_BROWSER_DIRECT')=='1'
OUT=ROOT/'evidence';(OUT/'screenshots').mkdir(exist_ok=True)
results=[];errors=[]
def check(name,fn):
    fn();results.append({'name':name,'status':'passed'});print('PASS',name,flush=True)
def fixture_crypto(page):
    page.expose_function('__testSHA256',lambda values:list(hashlib.sha256(bytes(values)).digest()))
    return '''<script>
if(!crypto.subtle)Object.defineProperty(crypto,'subtle',{value:{digest:async(algorithm,bytes)=>{if(algorithm!=='SHA-256')throw Error('Unexpected algorithm');return new Uint8Array(await __testSHA256(Array.from(new Uint8Array(bytes.buffer??bytes)))).buffer;}}});
if(!crypto.randomUUID)crypto.randomUUID=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');};
</script>'''
def main():
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    base=f'http://127.0.0.1:{port}'
    with tempfile.TemporaryDirectory(prefix='convos-browser-') as tmp:
        log=open(Path(tmp)/'server.log','w')
        server=subprocess.Popen(['node','dev/server.mjs'],cwd=ROOT,env={**os.environ,'PORT':str(port),'CONVOS_DB':str(Path(tmp)/'browser.sqlite')},stdout=log,stderr=log)
        try:
            for _ in range(100):
                try:
                    with urllib.request.urlopen(base+'/health') as r:
                        if r.status==200:break
                except OSError:time.sleep(.05)
            else:raise RuntimeError('Local server startup failed')
            with sync_playwright() as p:
                browser=p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or ('/usr/bin/chromium' if Path('/usr/bin/chromium').exists() else None),args=['--no-sandbox'])
                context=browser.new_context(viewport={'width':1440,'height':1000},accept_downloads=True)
                page=context.new_page();page.set_default_timeout(7000);page.on('pageerror',lambda e:errors.append(str(e)))
                bridge='' if DIRECT else fixture_crypto(page)
                def load_mock():
                    if DIRECT:page.goto(base+'/workbench/mock')
                    else:page.set_content((ROOT/'artifacts/workbench-mock.html').read_text().replace('<head>','<head>'+bridge))
                    expect(page.locator('.ac-proposal-status')).to_have_text('Needs review')
                def choose(name):
                    page.get_by_label('Scenario',exact=True).select_option(name)
                    expect(page.get_by_label('Message',exact=True)).to_be_visible()
                load_mock()
                check('mock runs against typed service and displays review',lambda:expect(page.locator('.ac-message')).to_have_count(2))
                page.screenshot(path=str(OUT/'screenshots/workbench-desktop.png'))
                # Native disclosure state and actual DOM node identity persist while controller polls.
                page.get_by_text('View exact changes',exact=True).click()
                page.get_by_label('Message',exact=True).fill('Retain this draft')
                page.evaluate("window.__textarea=document.querySelector('.ac-composer textarea');__textarea.focus();__textarea.setSelectionRange(2,7);window.__disclosure=document.querySelector('.ac-diff')")
                page.wait_for_timeout(800)
                check('polling preserves textarea node, selection, and open disclosure',lambda:assert_js(page,"__textarea===document.querySelector('.ac-composer textarea')&&__textarea.selectionStart===2&&__textarea.selectionEnd===7&&__disclosure.open"))
                page.get_by_role('button',name='In a CMS',exact=True).click()
                page.get_by_role('button',name='Approve & save draft',exact=True).click()
                check('approval records an applied proposal',lambda:expect(page.locator('.ac-proposal-status')).to_have_text('applied'))
                check('CMS preview updates only through confirmed host effect',lambda:expect(page.locator('.ac-host-text')).to_contain_text('Create a release page'))
                check('approval leaves the unsent draft unchanged',lambda:expect(page.get_by_label('Message',exact=True)).to_have_value('Retain this draft'))
                page.screenshot(path=str(OUT/'screenshots/workbench-embedded.png'))
                page.get_by_role('button',name='Standalone',exact=True).click()
                page.get_by_role('button',name='Skills',exact=True).click()
                expect(page.get_by_label('Skill instruction',exact=True)).to_have_value(__import__('re').compile(r'^#'))
                page.get_by_label('Skill instruction',exact=True).fill('# Edited in browser\n\nUse direct wording.')
                page.get_by_label('Revision note',exact=True).fill('Browser test')
                page.get_by_role('button',name='Save new version',exact=True).click()
                check('skill edit creates v2',lambda:expect(page.locator('.ac-version')).to_have_count(2))
                page.locator('.ac-version').filter(has_text='v1').locator('summary').click()
                page.get_by_role('button',name='Restore v1 as new version',exact=True).click()
                check('restore creates v3 rather than mutating v1',lambda:expect(page.locator('.ac-version')).to_have_count(3))
                page.screenshot(path=str(OUT/'screenshots/workbench-skills.png'))
                page.get_by_role('button',name='Conversations',exact=True).click()
                page.get_by_role('button',name='Details',exact=True).click()
                check('accepted run context still contains original skill version',lambda:expect(page.locator('.ac-json')).to_contain_text('"version": 1'))
                with page.expect_download() as download:
                    page.get_by_role('button',name='Export conversation JSON',exact=True).click()
                data=json.loads(Path(download.value.path()).read_text())
                check('export is retained structured conversation data',lambda:assert_true(data['schemaVersion']==1 and len(data['snapshot']['messages'])==2))
                page.get_by_role('dialog',name='Conversation details').get_by_role('button',name='Close',exact=True).click()
                choose('Stale proposal');expect(page.locator('.ac-proposal-status')).to_have_text('Needs review')
                page.get_by_role('button',name='Approve & save draft',exact=True).click()
                check('stale host base rejects approval without overwriting',lambda:expect(page.locator('.ac-proposal-status')).to_have_text('stale'))
                page.get_by_role('button',name='Prepare a new proposal',exact=True).click()
                check('stale refresh produces a separate proposal',lambda:expect(page.locator('.ac-proposal-status')).to_have_count(2))
                choose('Interrupted run');expect(page.locator('[data-run-status]')).to_have_attribute('data-run-status','failed')
                page.get_by_role('button',name='Retry run',exact=True).click()
                check('retry reaches review without duplicating the user message',lambda:expect(page.locator('.ac-proposal-status')).to_have_text('Needs review'))
                expect(page.locator('.ac-user')).to_have_count(1)
                choose('New conversation');expect(page.locator('.ac-empty')).to_be_visible()
                text='<img src=x onerror="window.xss=true">日本語'
                page.get_by_label('Message',exact=True).fill(text)
                page.get_by_label('Message',exact=True).dispatch_event('compositionstart',{'data':'日本語'})
                page.get_by_label('Message',exact=True).press('Enter')
                check('composition Enter does not send a message',lambda:expect(page.locator('.ac-user')).to_have_count(0))
                page.get_by_label('Message',exact=True).dispatch_event('compositionend',{'data':'日本語'})
                page.get_by_role('button',name='Send message',exact=True).click()
                check('post-composition send produces one accepted user message',lambda:expect(page.locator('.ac-user')).to_have_count(1))
                check('untrusted message markup is rendered as text',lambda:assert_js(page,"!window.xss&&document.querySelectorAll('.ac-messages img').length===0"))
                # Stream changes must leave the active composing textarea alone.
                page.get_by_label('Message',exact=True).fill('ongoing draft')
                page.evaluate("window.__textarea=document.querySelector('.ac-composer textarea');__textarea.setSelectionRange(1,4)")
                check('stream reaches proposal state',lambda:expect(page.locator('.ac-proposal-status')).to_have_text('Needs review'))
                check('incoming checkpoints retain composer DOM and selection',lambda:assert_js(page,"__textarea===document.querySelector('.ac-composer textarea')&&__textarea.selectionStart===1&&__textarea.selectionEnd===4"))
                page.get_by_role('button',name='Simulate disconnect',exact=True).click()
                check('disconnect is an explicit view state',lambda:expect(page.locator('.ac-banner')).to_contain_text('Disconnected'))
                page.get_by_role('button',name='Reconnect',exact=True).click()
                check('reconnect restores view and clears connection error',lambda:expect(page.locator('.ac-banner')).to_be_hidden())
                choose('Long history');expect(page.locator('.ac-message')).to_have_count(50)
                page.get_by_role('button',name='Load older messages',exact=True).click()
                check('older page expands retained history beyond newest 50',lambda:expect(page.locator('.ac-message')).to_have_count(54))
                choose('Ready for review');expect(page.locator('.ac-proposal-status')).to_have_text('Needs review')
                for width,height in [(390,844),(360,780),(768,1024),(1440,1000)]:
                    page.set_viewport_size({'width':width,'height':height});page.wait_for_timeout(100)
                    check(f'no horizontal document overflow at {width}px',lambda:assert_js(page,'document.documentElement.scrollWidth<=innerWidth+1'))
                page.set_viewport_size({'width':390,'height':844})
                page.get_by_role('button',name='Open navigation',exact=True).click()
                check('mobile navigation uses a native modal dialog',lambda:expect(page.get_by_role('dialog',name='Navigation',exact=True)).to_be_visible())
                page.get_by_role('button',name='Skills',exact=True).click()
                expect(page.locator('.ac-skill-chooser')).to_be_visible();page.locator('.ac-skill-chooser').click()
                check('mobile skill navigation uses dialog rather than dynamic select',lambda:expect(page.get_by_role('dialog',name='Choose a skill',exact=True)).to_be_visible())
                page.get_by_role('dialog',name='Choose a skill',exact=True).get_by_role('button',name='Writing guidelines',exact=True).click()
                page.screenshot(path=str(OUT/'screenshots/workbench-mobile-skills.png'))
                page.get_by_role('button',name='Open navigation',exact=True).click();page.get_by_role('button',name='Conversations',exact=True).click()
                page.screenshot(path=str(OUT/'screenshots/workbench-mobile.png'))
                # HTTP workbench: actual Node server + SQLite; bridge only the browser transport when navigation is prohibited.
                http=context.new_page();http.set_default_timeout(9000);http.on('pageerror',lambda e:errors.append(str(e)))
                if DIRECT:http.goto(base+'/workbench')
                else:
                    crypto_bridge=fixture_crypto(http)
                    def request(data):
                        path=data['url']
                        if not path.startswith('/api/v1/') and path!='/__dev/host':raise ValueError('Unexpected browser fixture path')
                        body=data.get('body');headers=data.get('headers') or {}
                        req=urllib.request.Request(base+path,data=body.encode() if body is not None else None,headers=headers,method=data.get('method','GET'))
                        try:
                            with urllib.request.urlopen(req,timeout=10) as r:return {'status':r.status,'headers':dict(r.headers),'body':r.read().decode()}
                        except urllib.error.HTTPError as e:return {'status':e.code,'headers':dict(e.headers),'body':e.read().decode()}
                    http.expose_function('__testHttp',request)
                    transport='''<script>globalThis.fetch=async(url,options={})=>{options.signal?.throwIfAborted();const r=await __testHttp({url:String(url),method:options.method??'GET',headers:Object.fromEntries(new Headers(options.headers)),body:options.body??null});options.signal?.throwIfAborted();return new Response(r.body,{status:r.status,headers:r.headers});};</script>'''
                    http.set_content((ROOT/'artifacts/workbench-http.html').read_text().replace('<head>','<head>'+crypto_bridge+transport))
                try:expect(http.locator('.ac-proposal-status')).to_have_text('Needs review')
                except Exception:
                    print('HTTP UI diagnostics:',errors,http.locator('body').inner_text(),flush=True)
                    raise
                http.get_by_role('button',name='Approve & save draft',exact=True).click()
                check('HTTP workbench applies via actual local server and SQLite',lambda:expect(http.locator('.ac-proposal-status')).to_have_text('applied'))
                http.get_by_role('button',name='+ New conversation',exact=True).click();expect(http.locator('.ac-empty')).to_be_visible()
                http.get_by_label('Message',exact=True).fill('A draft through real HTTP and SQLite')
                http.get_by_role('button',name='Send message',exact=True).click()
                check('HTTP workbench receives durable background-run checkpoints',lambda:expect(http.locator('.ac-proposal-status')).to_have_text('Needs review'))
                http.screenshot(path=str(OUT/'screenshots/workbench-sqlite.png'))
                check('no uncaught browser exceptions',lambda:assert_true(not errors,errors))
                browser.close()
        finally:
            server.terminate()
            try:server.wait(timeout=5)
            except subprocess.TimeoutExpired:server.kill();server.wait()
            log.close()
    report={'mode':'direct-navigation' if DIRECT else 'set-content + SHA256/HTTP test bridges','checks':results,'exceptions':errors,'zfbRuntime':'NOT RUN','realDeviceIME':'NOT RUN','directBrowserHTTP':DIRECT}
    (OUT/'browser-results.json').write_text(json.dumps(report,indent=2)+'\n')
def assert_true(value,extra=None):
    assert value,extra

def assert_js(page,expression):assert_true(page.evaluate(expression),expression)
if __name__=='__main__':main()
