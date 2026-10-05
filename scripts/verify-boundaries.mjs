import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const out=[];
  for(const entry of entries){if(['node_modules','.venv','__pycache__','.pytest_cache','.mypy_cache','.ruff_cache','dist','build'].includes(entry.name))continue;const path=`${dir}/${entry.name}`; if(entry.isDirectory())out.push(...await walk(path));else if(/\.(py|ts|tsx|json|ya?ml|html|css)$/.test(entry.name))out.push(path);}
  return out;
}
const forbidden=/(?:\b(?:motor|pymongo|MONGO_URL|DB_NAME|EMERGENT_LLM_KEY|emergentintegrations)\b|emergentagent\.|emergent\.host|from models\b|from legacy\b|\/validations\b)/i;
for(const path of [...await walk('frontend/src'),...await walk('backend/app'),'backend/requirements.txt','frontend/package.json','docker-compose.yml']){
  const source=await readFile(path,'utf8');assert.equal(forbidden.test(source),false,`Legacy dependency in active runtime: ${path}`);
  if(path.startsWith('frontend/src/')&&!path.includes('/test/'))assert.equal(/(?:VITE|REACT_APP)_[A-Z_]*(?:SERVICE_ROLE|SECRET|PRIVATE)/.test(source),false,`Browser-secret environment contract in ${path}`);
}
const app=await readFile('frontend/src/App.tsx','utf8');for(const route of ['home','studio','projects','discover','assets','setup','settings'])assert.ok(app.includes(`path: '/${route}'`),`Missing route ${route}`);
assert.ok((await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).length>=4);
console.log('Active runtime has no legacy database/auth/product imports; seven routes and source migrations exist.');
