/**
 * patch-xml-steps.js - Update XML scenario step attributes to MCP-aligned format:
 *   target= -> proc=
 *   parameter= -> path=  (for non-DIALOG, non-WAIT steps; otherwise value=)
 *   Add xmlns= to <Scenarios> element
 */
const fs = require('fs');

const files = [
  {
    path: 'components/helpers/shared/dist-resources/apptemplates/dashboard/scenarios.xml',
    ns: 'eu:plachy:sw:aiapi:builtin:dashboard',
  },
  {
    path: 'test/e2e/d2/scenarios.xml',
    ns: 'eu:plachy:sw:aiapi:builtin:d2',
  },
];

for (const { path, ns } of files) {
  let t = fs.readFileSync(path, 'utf8');
  const hasCRLF = t.includes('\r\n');
  t = t.replace(/\r\n/g, '\n');

  // 1. Add xmlns= to <Scenarios ...>
  t = t.replace(/<Scenarios( [^>]+)>/, (m, attrs) => {
    if (attrs.includes('xmlns=')) return m;
    return `<Scenarios${attrs} xmlns="${ns}">`;
  });

  // 2. Rename target= -> proc= on <step> lines
  t = t.replace(/<step ([^>]*)>/g, (m, inner) => {
    inner = inner.replace(/\btarget=/g, 'proc=');
    return `<step ${inner}>`;
  });

  // 3. Rename parameter= -> path= or value= on <step> lines
  //    DIALOG: parameter="dismiss|accept|..."   -> value= (no path semantics)
  //    WAIT:   parameter="<ms>"                 -> path= (used as timeout arg)
  //    others: parameter=                       -> path=
  t = t.replace(/<step ([^>]*)>/g, (m, inner) => {
    const isDialog = /\baction="DIALOG"/i.test(inner);
    const targetAttr = isDialog ? 'value' : 'path';
    inner = inner.replace(/\bparameter=/g, `${targetAttr}=`);
    return `<step ${inner}>`;
  });

  if (hasCRLF) t = t.replace(/\n/g, '\r\n');
  fs.writeFileSync(path, t, 'utf8');
  console.log('Updated:', path);
}
