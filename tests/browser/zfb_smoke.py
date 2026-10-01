"""Real zfb builds over native HTTP: public mock and separate SQLite UI. No bridges."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from functools import partial
from threading import Thread
from playwright.sync_api import sync_playwright, expect
import os, json, re, socket, subprocess, tempfile, time, urllib.request
ROOT=Path(__file__).resolve().parents[2]; DIST=ROOT/'apps/showcase/dist'; OUT=ROOT/'evidence'
(OUT/'screenshots').mkdir(parents=True,exist_ok=True)
for app in ['showcase','local']:
    if not (ROOT/f'apps/{app}/dist/index.html').exists(): raise SystemExit(f'Build apps/{app} with real zfb first')
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(DIST)))
Thread(target=server.serve_forever,daemon=True).start()
checks=[];errors=[];requests=[]
def passed(name): checks.append(name); print('PASS',name,flush=True)
def js(page,expression): assert page.evaluate(expression), expression
def wait_server(base, child):
    for _ in range(100):
        try:
            if urllib.request.urlopen(base+'/health').status==200:return
        except OSError:time.sleep(.05)
        if child.poll() is not None:break
    raise AssertionError('Local server did not start')
try:
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path=os.getenv('CHROMIUM_PATH') or None)
  try:
   page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
   page.set_default_timeout(10000);page.on('pageerror',lambda e:errors.append(str(e)))
   page.on('request',lambda r:requests.append(r.url))
   held=[];page.route('**/assets/*.js',lambda route:held.append(route))
   base=f'http://127.0.0.1:{server.server_port}'
   page.goto(base,wait_until='commit')
   page.get_by_label('Message',exact=True).fill('Typed before hydration 日本語')
   page.wait_for_timeout(50)
   assert held,'No generated island script requested'
   for route in held:route.continue_()
   page.unroute('**/assets/*.js')
   expect(page.locator('[data-zfb-island-mounted]').first).to_be_visible()
   expect(page.locator('.ac-proposal-status')).to_have_text('Needs review')
   expect(page.get_by_label('Message',exact=True)).to_have_value('Typed before hydration 日本語')
   passed('real hydration preserves pre-activation input')
   page.locator('.ac-diff summary').click()
   page.evaluate("window.savedComposer=document.querySelector('textarea');savedComposer.setSelectionRange(2,6);window.savedDiff=document.querySelector('.ac-diff');window.savedMessage=document.querySelector('.ac-assistant')")
   page.wait_for_timeout(850)
   js(page,"savedComposer===document.querySelector('textarea')&&savedComposer.selectionStart===2&&savedComposer.selectionEnd===6&&savedDiff.open")
   page.get_by_role('button',name='In a CMS',exact=True).click()
   page.get_by_role('button',name='Approve & save draft',exact=True).click()
   expect(page.locator('.ac-proposal-status')).to_have_text('applied')
   expect(page.locator('.ac-host-text')).to_contain_text('Create a release page')
   js(page,"savedDiff===document.querySelector('.ac-diff')&&savedDiff.open&&savedMessage===document.querySelector('.ac-assistant')")
   passed('keyed updates retain composer, caret, message and open diff; reviewed host update')
   page.screenshot(path=str(OUT/'screenshots/zfb-embedded.png'))
   page.get_by_role('button',name='Standalone',exact=True).click()
   page.get_by_role('button',name='Details',exact=True).click()
   dialog=page.get_by_role('dialog',name='Conversation details',exact=True)
   expect(dialog).to_be_visible();expect(dialog.locator('.ac-json')).to_contain_text('"version": 1')
   with page.expect_download() as download:page.get_by_role('button',name='Export conversation JSON',exact=True).click()
   data=json.loads(Path(download.value.path()).read_text());assert data['schemaVersion']==1 and len(data['snapshot']['messages'])==2
   page.get_by_role('button',name='Rename conversation',exact=True).click()
   page.get_by_label('Conversation title',exact=True).fill('Renamed release')
   page.get_by_role('button',name='Save title',exact=True).click()
   expect(page.locator('h1')).to_have_text('Renamed release')
   dialog.get_by_role('button',name='Close',exact=True).click()
   passed('native details, export and rename dialogs')
   page.get_by_role('button',name='Skills',exact=True).click()
   expect(page.get_by_label('Skill instruction',exact=True)).to_have_value(re.compile('^#'))
   page.get_by_label('Skill instruction',exact=True).fill('# Edited instructions\nUse direct wording.')
   page.get_by_label('Revision note',exact=True).fill('Browser revision')
   page.get_by_role('button',name='Save new version',exact=True).click()
   expect(page.locator('.ac-version')).to_have_count(2)
   page.locator('.ac-version').filter(has_text='v1').locator('summary').click()
   page.get_by_role('button',name='Restore as new version',exact=True).click()
   expect(page.locator('.ac-version')).to_have_count(3)
   page.screenshot(path=str(OUT/'screenshots/zfb-skills.png'))
   page.get_by_role('button',name='Conversations',exact=True).click()
   page.get_by_role('button',name='Details',exact=True).click()
   expect(dialog.locator('.ac-json')).to_contain_text('"version": 1')
   dialog.get_by_role('button',name='Close',exact=True).click()
   passed('skill save/restore append versions; accepted context retains original pins')
   page.get_by_role('button',name='Archive',exact=True).click()
   expect(page.get_by_role('button',name='Restore',exact=True)).to_be_visible()
   page.get_by_role('button',name='Archived conversations',exact=True).click()
   expect(page.locator('.ac-thread')).to_have_count(1)
   page.get_by_role('button',name='Restore',exact=True).click()
   page.get_by_role('button',name='Active conversations',exact=True).click()
   expect(page.locator('.ac-thread')).to_have_count(3)
   page.get_by_label('Search conversations',exact=True).fill('Inquiry')
   expect(page.locator('.ac-thread')).to_have_count(1)
   page.get_by_label('Search conversations',exact=True).fill('')
   passed('search and reversible archive/restore')
   def scenario(name):
       page.get_by_label('Scenario',exact=True).select_option(name)
       expect(page.locator('h1')).not_to_have_text('Preparing conversation…')
   scenario('Stale proposal');expect(page.locator('.ac-proposal-status')).to_have_text('Needs review')
   page.get_by_role('button',name='Approve & save draft',exact=True).click()
   expect(page.locator('.ac-proposal-status')).to_have_text('stale')
   page.get_by_role('button',name='Prepare a new proposal',exact=True).click()
   expect(page.locator('.ac-proposal-status')).to_have_count(2)
   expect(page.locator('.ac-proposal-status').last).to_have_text('Needs review')
   passed('stale approval rejected; fresh proposal requires review')
   scenario('Interrupted run');expect(page.locator('[data-run-status]')).to_have_attribute('data-run-status','failed')
   page.get_by_role('button',name='Retry run',exact=True).click();expect(page.locator('.ac-proposal-status')).to_have_text('Needs review')
   expect(page.locator('.ac-user')).to_have_count(1);passed('retry keeps a single accepted user turn')
   scenario('New conversation');expect(page.locator('.ac-empty')).to_be_visible()
   text='<img src=x onerror="window.xss=true">日本語'
   composer=page.get_by_label('Message',exact=True);composer.fill(text)
   composer.dispatch_event('compositionstart',{'data':'日本語'});composer.press('Enter');expect(page.locator('.ac-user')).to_have_count(0)
   composer.dispatch_event('compositionend',{'data':'日本語'});page.get_by_role('button',name='Send ↑',exact=True).click()
   expect(page.locator('.ac-user')).to_have_count(1);expect(page.locator('.ac-user')).to_contain_text(text)
   page.get_by_role('button',name='Disconnect',exact=True).click();expect(page.get_by_role('button',name='Reconnect',exact=True)).to_be_visible()
   page.wait_for_timeout(1200);page.get_by_role('button',name='Reconnect',exact=True).click()
   expect(page.locator('.ac-proposal-status')).to_have_text('Needs review');js(page,'!window.xss')
   passed('IME Enter guard, text safety and reconnect replay during generation')
   scenario('Streaming response');page.get_by_role('button',name='Stop',exact=True).click()
   expect(page.locator('[data-run-status]')).to_have_attribute('data-run-status','cancelled');passed('explicit cancellation stops active run')
   scenario('New conversation');composer.fill('First thread draft')
   page.get_by_role('button',name='+ New conversation',exact=True).click();expect(composer).to_have_value('')
   composer.fill('Second thread draft');page.locator('.ac-thread').nth(1).click();expect(composer).to_have_value('First thread draft')
   passed('new conversations and independent thread drafts')
   scenario('Long history');expect(page.locator('.ac-message')).to_have_count(50)
   page.locator('.ac-scroll').evaluate('(el)=>{el.scrollTop=0}')
   page.evaluate("window.anchor=document.querySelector('[data-message-id]');window.anchorTop=anchor.getBoundingClientRect().top")
   page.get_by_role('button',name='Load older messages',exact=True).click();expect(page.locator('.ac-message')).to_have_count(54)
   page.wait_for_timeout(100);js(page,'Math.abs(anchor.getBoundingClientRect().top-anchorTop)<3')
   page.get_by_role('button',name='Jump to latest ↓',exact=True).click()
   js(page,"(()=>{const e=document.querySelector('.ac-scroll');return e.scrollHeight-e.scrollTop-e.clientHeight<3})()")
   passed('older-page insertion preserves reading anchor; jump returns to latest')
   scenario('Ready for review');expect(page.locator('.ac-proposal-status')).to_have_text('Needs review')
   for width in [360,390,768,1440]:
       page.set_viewport_size({'width':width,'height':900})
       js(page,'document.documentElement.scrollWidth<=innerWidth')
       js(page,"(()=>{const e=document.querySelector('.ac-composer').getBoundingClientRect();return e.left>=0&&e.right<=innerWidth&&e.bottom<=innerHeight})()")
       if width<600:
           page.get_by_role('button',name='Details',exact=True).click();expect(dialog).to_be_visible();dialog.get_by_role('button',name='Close',exact=True).click()
       if width<768:
           page.get_by_role('button',name='Open navigation',exact=True).click()
           nav=page.get_by_role('dialog',name='Navigation',exact=True);expect(nav).to_be_visible()
           nav.get_by_role('button',name='Skills',exact=True).click()
           page.locator('.ac-skill-chooser').click();chooser=page.get_by_role('dialog',name='Choose a skill',exact=True);expect(chooser).to_be_visible()
           chooser.get_by_role('button',name='Close',exact=True).click()
           page.get_by_role('button',name='Open navigation',exact=True).click();nav.get_by_role('button',name='Conversations',exact=True).click()
       if width in [390,1440]:page.screenshot(path=str(OUT/f'screenshots/zfb-{width}.png'))
   passed('responsive geometry and native mobile navigation/skill dialogs at 360/390/768/1440')
   assert all(url.startswith(base) for url in requests), requests
   assert not any('/api/' in url or '/__dev/' in url for url in requests)
   passed('public showcase makes no API, model, or external requests')
   # Separate generated app uses real HTTP/SQLite, native fetch and CSP.
   with tempfile.TemporaryDirectory(prefix='convos-zfb-') as tmp:
       with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
       localbase=f'http://127.0.0.1:{port}'
       env={**os.environ,'PORT':str(port),'CONVOS_DB':str(Path(tmp)/'db.sqlite')}
       with open(Path(tmp)/'server.log','w') as log:
        child=subprocess.Popen(['node','dev/server.mjs'],cwd=ROOT,env=env,stdout=log,stderr=log)
        try:
         wait_server(localbase,child)
         local=browser.new_page(viewport={'width':1440,'height':1000});local.on('pageerror',lambda e:errors.append(str(e)))
         response=local.goto(localbase);assert response.status==200
         expect(local.locator('[data-zfb-island-mounted]').first).to_be_visible()
         expect(local.locator('.ac-proposal-status')).to_have_text('Needs review')
         expect(local.get_by_label('Scenario',exact=True)).to_be_hidden()
         local.get_by_role('button',name='In a CMS',exact=True).click()
         local.get_by_role('button',name='Approve & save draft',exact=True).click();expect(local.locator('.ac-proposal-status')).to_have_text('applied')
         expect(local.locator('.ac-host-text')).to_contain_text('Create an October')
         local.get_by_role('button',name='Standalone',exact=True).click()
         local.get_by_role('button',name='+ New conversation',exact=True).click()
         expect(local.locator('h1')).to_have_text('New conversation')
         expect(local.locator('.ac-empty')).to_be_visible()
         local.get_by_label('Message',exact=True).fill('Persist this zudo-react request across restart')
         local.get_by_role('button',name='Send ↑',exact=True).click();expect(local.locator('.ac-proposal-status')).to_have_text('Needs review')
         local.get_by_role('button',name='Approve & save draft',exact=True).click();expect(local.locator('.ac-proposal-status')).to_have_text('applied')
         child.terminate();child.wait(timeout=10)
         child=subprocess.Popen(['node','dev/server.mjs'],cwd=ROOT,env=env,stdout=log,stderr=log);wait_server(localbase,child)
         local.reload();expect(local.locator('.ac-user')).to_contain_text('Persist this zudo-react request across restart')
         expect(local.locator('.ac-proposal-status')).to_have_text('applied')
         local.screenshot(path=str(OUT/'screenshots/zfb-sqlite.png'))
         passed('separate zfb HTTP UI accepts, reviews, applies and persists across server restart')
        finally:
         child.terminate();child.wait(timeout=10)
   assert not errors,errors
   passed('no uncaught browser exceptions')
   (OUT/'zfb-browser-results.json').write_text(json.dumps({'checks':checks,'exceptions':errors,'mode':'actual-zfb-build-direct-browser'},indent=2)+'\n')
  finally:browser.close()
finally:server.shutdown();server.server_close()
