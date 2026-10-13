const fs = require('fs')
const path = 'C:/Users/Administrator/WorkBuddy/myproject/gamevibe/src/data/games.ts'
let src = fs.readFileSync(path, 'utf8')

const map = {
  elden: 'elden-ring',
  bg3: 'baldurs-gate-3',
  hades2: 'hades-2',
  palworld: 'palworld',
  cyberpunk: 'cyberpunk-2077',
  stardew: 'stardew-valley',
  liesofp: 'lies-of-p',
  valorant: 'valorant',
  deadcells: 'dead-cells',
  hollowknight: 'hollow-knight',
  cs2: 'cs2',
  dave: 'dave-the-diver',
  disco: 'disco-elysium',
  mhwilds: 'monster-hunter-wilds',
  vampire: 'vampire-survivors',
  gow: 'god-of-war',
}

for (const [seed, id] of Object.entries(map)) {
  src = src.split(`\${coverBase}/${seed}/400/560`).join(`/covers/${id}.png`)
  src = src.split(`\${coverBase}/${seed}-banner/1200/400`).join(`/covers/${id}.png`)
}

// remove the now-unused coverBase const
src = src.replace(/const coverBase = '[^']*'\n/, '')

fs.writeFileSync(path, src)
console.log('done; coverBase remaining:', src.includes('coverBase'))
