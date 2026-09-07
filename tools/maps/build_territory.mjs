/**
 * Paints the ASCII rows for the territory maps. Kept as a script (rather than
 * hand-typing 26 x 40 characters) so the terrain reads as coherent geography
 * — a river, a ridge, an urban belt — instead of noise.
 */
const W = 40, H = 26;

function blank(fill) { return Array.from({length:H},()=>Array.from({length:W},()=>fill)); }
function rect(g,x0,y0,x1,y1,c){ for(let y=Math.max(0,y0);y<=Math.min(H-1,y1);y++) for(let x=Math.max(0,x0);x<=Math.min(W-1,x1);x++) g[y][x]=c; }
function blob(g,cx,cy,r,c){ for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const d=Math.hypot(x-cx,(y-cy)*1.6); if(d<=r) g[y][x]=c; } }

// --- surface: Ashline Corridor -------------------------------------------
const s = blank('.');
// mountain spine along the north and south edges (natural walls)
rect(s,0,0,W-1,1,'m'); rect(s,0,H-2,W-1,H-1,'m');
// a river cutting north-south, fordable in two places
for(let y=2;y<H-2;y++){ s[y][17]='w'; s[y][18]='w'; }
s[8][17]='.'; s[8][18]='.';    // north ford
s[18][17]='.'; s[18][18]='.';  // south ford
// urban belt through the middle (the fuel dump sits in it)
rect(s,19,11,25,15,'u');
// forests west and east
blob(s,10,6,4,'f'); blob(s,13,19,4,'f'); blob(s,31,19,4,'f');
// the colony plateau north-east
blob(s,30,7,4,'u');
// scattered ridges to break sightlines
rect(s,7,12,9,13,'m'); rect(s,27,12,29,13,'m'); rect(s,34,9,35,16,'m');
// keep the deploy pocket and every site clear
const clear=[[3,13],[11,6],[14,19],[22,13],[30,7],[32,19]];
for(const [cx,cy] of clear) for(let y=cy-1;y<=cy+1;y++) for(let x=cx-1;x<=cx+1;x++) if(s[y]&&s[y][x]!==undefined&&s[y][x]!=='w') s[y][x]='.';

// --- space: Kessler Anchorage --------------------------------------------
const p = blank('.');
rect(p,0,0,W-1,0,'#'); rect(p,0,H-1,W-1,H-1,'#');
blob(p,9,7,4,'d'); blob(p,14,19,4,'d'); blob(p,31,18,5,'d');   // debris fields
blob(p,22,13,3,'s');                                            // the anchorage itself
rect(p,17,3,18,10,'d'); rect(p,17,16,18,23,'d');                // a debris curtain
blob(p,30,7,3,'r');                                             // radiation pocket
for(const [cx,cy] of clear) for(let y=cy-1;y<=cy+1;y++) for(let x=cx-1;x<=cx+1;x++) if(p[y]&&p[y][x]!==undefined) p[y][x]='.';

export const surfaceRows = s.map(r=>r.join(''));
export const spaceRows = p.map(r=>r.join(''));
console.log(JSON.stringify({ surfaceRows, spaceRows }));
