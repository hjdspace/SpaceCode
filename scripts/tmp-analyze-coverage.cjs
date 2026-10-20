const data = require('../coverage/coverage-final.json');
const norm = (p) => {
  const m = p.match(/(src|electron)[\\/](.*)$/);
  return m ? m[1] + '/' + m[2] : p;
};
const files = Object.entries(data).map(([path, cov]) => {
  const s = cov.s, b = cov.b, f = cov.fn;
  const totalS = Object.keys(s).length, hitS = Object.values(s).filter(v => v > 0).length;
  const totalB = Object.values(b).flat().length, hitB = Object.values(b).flat().filter(v => v > 0).length;
  const totalF = Object.keys(f).length, hitF = Object.values(f).filter(v => v > 0).length;
  return {
    path: norm(path),
    stmts: totalS ? (hitS / totalS) * 100 : 100,
    branches: totalB ? (hitB / totalB) * 100 : 100,
    funcs: totalF ? (hitF / totalF) * 100 : 100,
    totalS, hitS, totalB, hitB,
    isVue: path.endsWith('.vue'),
    isTest: path.endsWith('.test.ts'),
  };
}).filter(x => !x.path.includes('node_modules') && !x.path.endsWith('.d.ts') && !x.path.includes('/i18n/') && !x.isVue && !x.isTest && !x.path.includes('__tests__'));
files.sort((a, b) => (a.stmts - b.stmts) || (a.branches - b.branches));
console.log('TOTAL TS FILES WITH DATA:', files.length);
console.log('=== LOWEST STATEMENT COVERAGE ===');
for (const f of files.filter(f => f.stmts < 60 && f.totalS >= 15).slice(0, 45)) {
  console.log(
    f.stmts.toFixed(1).padStart(5) + '% stmt | ' +
    f.branches.toFixed(1).padStart(5) + '% br | ' +
    f.funcs.toFixed(1).padStart(5) + '% fn | ' +
    String(f.totalS).padStart(4) + ' stmts | ' + f.path
  );
}
