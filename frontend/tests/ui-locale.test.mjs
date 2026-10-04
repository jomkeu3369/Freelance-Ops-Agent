import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import ts from 'typescript';
import { normalizeLocale, translateUi } from '../app/lib/ui-locale.mjs';
import { englishUi as workspaceEnglish } from '../app/lib/ui-english.mjs';
import { englishUi as landingEnglish } from '../features/home/ui-english.mjs';
const englishUi = { ...workspaceEnglish, ...landingEnglish };

test('unsupported language falls back to Korean; interpolation preserves user-provided content', () => {
  for (const value of [null, '', 'fr', 'EN', 'ko-KR']) assert.equal(normalizeLocale(value), 'ko');
  assert.equal(normalizeLocale('en'), 'en');
  assert.equal(translateUi('사용자 문서 그대로', 'en'), '사용자 문서 그대로');
  assert.equal(translateUi('{v0} 상태', 'en', {v0: '진행 중'}), 'Status of 진행 중');
  assert.equal(translateUi('로그인'), '로그인');
});
test('every explicitly marked Korean interface message has English copy and matching placeholders', async () => {
  const missing=[];
  async function visitDirectory(dir) {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      const url=new URL(entry.name+(entry.isDirectory()?'/':''),dir);
      if(entry.isDirectory()) { await visitDirectory(url); continue; }
      if(!entry.name.endsWith('.tsx')) continue;
      const source=ts.createSourceFile(entry.name,await readFile(url,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
      function visit(node) {
        if(ts.isCallExpression(node)&&node.expression.getText(source)==='t'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])) {
          const key=node.arguments[0].text;
          if(/[가-힣]/.test(key)&&!Object.hasOwn(englishUi,key))missing.push(`${entry.name}: ${key}`);
          if(Object.hasOwn(englishUi,key)) {
            const params=s=>[...s.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();
            assert.deepEqual(params(englishUi[key]),params(key),key);
          }
        }
        ts.forEachChild(node,visit);
      }visit(source);
    }
  }
  await visitDirectory(new URL('../features/',import.meta.url));
  assert.deepEqual(missing,[]);
});
