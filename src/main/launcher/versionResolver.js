// Construye el version JSON que mclc va a leer: merge de vanilla (Mojang) +
// perfil de Fabric en UN solo archivo, en versions/<profileId>/<profileId>.json.
//
// Por que el merge: mclc con version.custom lee versions/<custom>/<custom>.json como
// modifyJson y versions/<custom>/<mc>.json como version vanilla. Si en el segundo
// dejamos el perfil Fabric pelado, el juego arranca SIN --username/--accessToken.
const fs = require('fs-extra');
const path = require('path');
const { getJson } = require('./httpClient');

function dedupeByName(libs) {
  const seen = new Set();
  const out = [];
  for (const l of libs) {
    if (!l || !l.name || seen.has(l.name)) continue;
    seen.add(l.name);
    out.push(l);
  }
  return out;
}

async function ensureVersionJson({ gameDir, mc, loader, log }) {
  const profileId = `fabric-loader-${loader}-${mc}`;
  const vdir = path.join(gameDir, 'versions', profileId);
  const vanillaDir = path.join(gameDir, 'versions', mc);
  const vanillaFile = path.join(vanillaDir, `${mc}.json`);
  const fabricFile = path.join(vdir, 'fabric-profile.json');
  const outFile = path.join(vdir, `${profileId}.json`);

  // JSON vanilla (cacheado; tras la primera vez no necesita Mojang)
  if (!fs.existsSync(vanillaFile)) {
    if (log) log.info('Bajando el manifiesto de versiones de Mojang...');
    const manifest = await getJson('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
    const v = (manifest.versions || []).find((x) => x.id === mc);
    if (!v) throw new Error(`No encontre Minecraft ${mc} en Mojang`);
    const vpkg = await getJson(v.url);
    fs.ensureDirSync(vanillaDir);
    fs.writeJsonSync(vanillaFile, vpkg, { spaces: 2 });
  }
  const vanilla = fs.readJsonSync(vanillaFile);

  // Perfil Fabric (cacheado; si Fabric meta esta caido, igual arranca)
  if (!fs.existsSync(fabricFile)) {
    const profile = await getJson(`https://meta.fabricmc.net/v2/versions/loader/${mc}/${loader}/profile/json`);
    fs.ensureDirSync(vdir);
    fs.writeJsonSync(fabricFile, profile, { spaces: 2 });
  }
  const fabric = fs.readJsonSync(fabricFile);

  const merged = {
    id: profileId,
    type: 'release',
    mainClass: fabric.mainClass,
    assetIndex: vanilla.assetIndex,
    assets: vanilla.assets,
    downloads: vanilla.downloads,
    javaVersion: vanilla.javaVersion,
    arguments: {
      game: (vanilla.arguments && vanilla.arguments.game) || [],
      jvm: [], // los jvm args los pone mclc + nuestro customArgs
    },
    libraries: dedupeByName([...(vanilla.libraries || []), ...(fabric.libraries || [])]),
    _invalimon: { mc, loader, builtAt: Date.now() },
  };

  fs.ensureDirSync(vdir);
  fs.writeJsonSync(outFile, merged, { spaces: 2 });
  // Copia con el nombre vanilla: cubre el caso de correr mclc sin overrides.versionJson
  fs.writeJsonSync(path.join(vdir, `${mc}.json`), merged, { spaces: 2 });

  return { profileId, versionJson: outFile, vanilla };
}

module.exports = { ensureVersionJson };
