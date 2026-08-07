/**
 * Memorable worktree / thread labels (Conductor-style nicknames).
 * Slug is the directory + `thread/<slug>` branch; `name` is the UI title.
 */
import { SOCCER_TEAM_META } from './team-meta.js';

export interface TeamName {
  name: string;
  slug: string;
  /** City / region where the club is based. */
  location: string;
  /** Top competition the club plays in. */
  league: string;
}

type TeamSeed = { name: string; slug: string };

function withMeta(seed: TeamSeed): TeamName {
  const baseSlug = seed.slug.replace(/-\d+$/, '');
  const meta = SOCCER_TEAM_META[baseSlug];
  return {
    name: seed.name,
    slug: seed.slug,
    location: meta?.location ?? 'Unknown',
    league: meta?.league ?? 'Unknown league',
  };
}

/** Famous soccer clubs — short, recognizable thread labels. */
const FAMOUS_SOCCER_TEAM_SEEDS: readonly TeamSeed[] = [

  { name: 'Aalborg', slug: 'aalborg' },
  { name: 'Aalesund', slug: 'aalesund' },
  { name: 'Aarhus', slug: 'aarhus' },
  { name: 'Aberdeen', slug: 'aberdeen' },
  { name: 'AC Milan', slug: 'ac-milan' },
  { name: 'ADO Den Haag', slug: 'ado-den-haag' },
  { name: 'AIK', slug: 'aik' },
  { name: 'Ajaccio', slug: 'ajaccio' },
  { name: 'Ajax', slug: 'ajax' },
  { name: 'Al Ahly', slug: 'al-ahly' },
  { name: 'Al Hilal', slug: 'al-hilal' },
  { name: 'Alajuelense', slug: 'alajuelense' },
  { name: 'Almere City', slug: 'almere-city' },
  { name: 'Amiens', slug: 'amiens' },
  { name: 'Angers', slug: 'angers' },
  { name: 'Anyang', slug: 'anyang' },
  { name: 'Argentinos Juniors', slug: 'argentinos-juniors' },
  { name: 'Arsenal', slug: 'arsenal' },
  { name: 'Aston Villa', slug: 'aston-villa' },
  { name: 'Athletico Paranaense', slug: 'athletico-paranaense' },
  { name: 'Atlanta United', slug: 'atlanta-united' },
  { name: 'Atlas', slug: 'atlas' },
  { name: 'Atlético Madrid', slug: 'atletico-madrid' },
  { name: 'Atlético Mineiro', slug: 'atletico-mineiro' },
  { name: 'Atlético San Luis', slug: 'atletico-san-luis' },
  { name: 'Augsburg', slug: 'augsburg' },
  { name: 'Austin FC', slug: 'austin-fc' },
  { name: 'Auxerre', slug: 'auxerre' },
  { name: 'Avispa Fukuoka', slug: 'avispa-fukuoka' },
  { name: 'AZ Alkmaar', slug: 'az' },
  { name: 'Bahia', slug: 'bahia' },
  { name: 'Banfield', slug: 'banfield' },
  { name: 'Barcelona', slug: 'barcelona' },
  { name: 'Bayer Leverkusen', slug: 'bayer-leverkusen' },
  { name: 'Bayern Munich', slug: 'bayern-munich' },
  { name: 'Belgrano', slug: 'belgrano' },
  { name: 'Benfica', slug: 'benfica' },
  { name: 'Birmingham Legion', slug: 'birmingham-legion' },
  { name: 'Boca Juniors', slug: 'boca-juniors' },
  { name: 'Bodø/Glimt', slug: 'bodo-glimt' },
  { name: 'Bordeaux', slug: 'bordeaux' },
  { name: 'Borussia Dortmund', slug: 'borussia-dortmund' },
  { name: 'Botafogo', slug: 'botafogo' },
  { name: 'Bragantino', slug: 'bragantino' },
  { name: 'Brann', slug: 'brann' },
  { name: 'Brest', slug: 'brest' },
  { name: 'Brommapojkarna', slug: 'brommapojkarna' },
  { name: 'Brøndby', slug: 'brondby' },
  { name: 'Brooklyn FC', slug: 'brooklyn-fc' },
  { name: 'Bucheon', slug: 'bucheon' },
  { name: 'Caen', slug: 'caen' },
  { name: 'Cambuur', slug: 'cambuur' },
  { name: 'Carmelita', slug: 'carmelita' },
  { name: 'Cartaginés', slug: 'cartagines' },
  { name: 'Ceará', slug: 'ceara' },
  { name: 'Celtic', slug: 'celtic' },
  { name: 'Central Córdoba', slug: 'central-cordoba' },
  { name: 'Cerezo Osaka', slug: 'cerezo-osaka' },
  { name: 'CF Montréal', slug: 'cf-montreal' },
  { name: 'Charleston Battery', slug: 'charleston-battery' },
  { name: 'Charlotte FC', slug: 'charlotte-fc' },
  { name: 'Chelsea', slug: 'chelsea' },
  { name: 'Chicago Fire', slug: 'chicago-fire' },
  { name: 'Chivas', slug: 'chivas' },
  { name: 'Clermont', slug: 'clermont' },
  { name: 'Club América', slug: 'club-america' },
  { name: 'Cologne', slug: 'cologne' },
  { name: 'Colorado Rapids', slug: 'colorado-rapids' },
  { name: 'Columbus Crew', slug: 'columbus-crew' },
  { name: 'Corinthians', slug: 'corinthians' },
  { name: 'Cruz Azul', slug: 'cruz-azul' },
  { name: 'Cruzeiro', slug: 'cruzeiro' },
  { name: 'Daejeon', slug: 'daejeon' },
  { name: 'DC United', slug: 'dc-united' },
  { name: 'Defensa y Justicia', slug: 'defensa-y-justicia' },
  { name: 'Degerfors', slug: 'degerfors' },
  { name: 'Detroit City', slug: 'detroit-city' },
  { name: 'Dijon', slug: 'dijon' },
  { name: 'Djurgården', slug: 'djurgarden' },
  { name: 'Dundee', slug: 'dundee' },
  { name: 'Dundee United', slug: 'dundee-united' },
  { name: 'Dynamo Kyiv', slug: 'dynamo-kyiv' },
  { name: 'Eintracht Frankfurt', slug: 'eintracht-frankfurt' },
  { name: 'El Paso Locomotive', slug: 'el-paso-locomotive' },
  { name: 'Elfsborg', slug: 'elfsborg' },
  { name: 'Emmen', slug: 'emmen' },
  { name: 'Esbjerg', slug: 'esbjerg' },
  { name: 'Estudiantes', slug: 'estudiantes' },
  { name: 'Everton', slug: 'everton' },
  { name: 'Excelsior', slug: 'excelsior' },
  { name: 'Fagiano Okayama', slug: 'fagiano-okayama' },
  { name: 'Falkirk', slug: 'falkirk' },
  { name: 'FC Cincinnati', slug: 'fc-cincinnati' },
  { name: 'FC Copenhagen', slug: 'fc-copenhagen' },
  { name: 'FC Dallas', slug: 'fc-dallas' },
  { name: 'FC Seoul', slug: 'fc-seoul' },
  { name: 'FC Tokyo', slug: 'fc-tokyo' },
  { name: 'FC Tulsa', slug: 'fc-tulsa' },
  { name: 'Feyenoord', slug: 'feyenoord' },
  { name: 'Flamengo', slug: 'flamengo' },
  { name: 'Fluminense', slug: 'fluminense' },
  { name: 'Fortaleza', slug: 'fortaleza' },
  { name: 'Fortuna Sittard', slug: 'fortuna-sittard' },
  { name: 'Fredrikstad', slug: 'fredrikstad' },
  { name: 'Freiburg', slug: 'freiburg' },
  { name: 'GAIS', slug: 'gais' },
  { name: 'Galatasaray', slug: 'galatasaray' },
  { name: 'Gamba Osaka', slug: 'gamba-osaka' },
  { name: 'Gangwon', slug: 'gangwon' },
  { name: 'Gimcheon Sangmu', slug: 'gimcheon-sangmu' },
  { name: 'Gimnasia', slug: 'gimnasia' },
  { name: 'Gladbach', slug: 'gladbach' },
  { name: 'Go Ahead Eagles', slug: 'go-ahead-eagles' },
  { name: 'Godoy Cruz', slug: 'godoy-cruz' },
  { name: 'Grêmio', slug: 'gremio' },
  { name: 'Groningen', slug: 'groningen' },
  { name: 'Guadalupe', slug: 'guadalupe' },
  { name: 'Guanacasteca', slug: 'guanacasteca' },
  { name: 'Guingamp', slug: 'guingamp' },
  { name: 'Gwangju', slug: 'gwangju' },
  { name: 'Häcken', slug: 'hacken' },
  { name: 'Halmstad', slug: 'halmstad' },
  { name: 'Hamburg', slug: 'hamburg' },
  { name: 'Hammarby', slug: 'hammarby' },
  { name: 'Hartford Athletic', slug: 'hartford-athletic' },
  { name: 'Haugesund', slug: 'haugesund' },
  { name: 'Hearts', slug: 'hearts' },
  { name: 'Heerenveen', slug: 'heerenveen' },
  { name: 'Heidenheim', slug: 'heidenheim' },
  { name: 'Helsingborg', slug: 'helsingborg' },
  { name: 'Heracles', slug: 'heracles' },
  { name: 'Herediano', slug: 'herediano' },
  { name: 'Hibernian', slug: 'hibernian' },
  { name: 'Hoffenheim', slug: 'hoffenheim' },
  { name: 'Horsens', slug: 'horsens' },
  { name: 'Houston Dynamo', slug: 'houston-dynamo' },
  { name: 'Huracán', slug: 'huracan' },
  { name: 'IFK Göteborg', slug: 'ifk-goteborg' },
  { name: 'IFK Norrköping', slug: 'norrkoping' },
  { name: 'Incheon United', slug: 'incheon-united' },
  { name: 'Independiente', slug: 'independiente' },
  { name: 'Indy Eleven', slug: 'indy-eleven' },
  { name: 'Instituto', slug: 'instituto' },
  { name: 'Inter Miami', slug: 'inter-miami' },
  { name: 'Inter Milan', slug: 'inter-milan' },
  { name: 'Internacional', slug: 'internacional' },
  { name: 'JEF United', slug: 'jef-united' },
  { name: 'Jeju SK', slug: 'jeju-sk' },
  { name: 'Jeonbuk', slug: 'jeonbuk' },
  { name: 'Juárez', slug: 'juarez' },
  { name: 'Juventude', slug: 'juventude' },
  { name: 'Juventus', slug: 'juventus' },
  { name: 'Kalmar FF', slug: 'kalmar' },
  { name: 'Kashima Antlers', slug: 'kashima-antlers' },
  { name: 'Kashiwa Reysol', slug: 'kashiwa-reysol' },
  { name: 'Kawasaki Frontale', slug: 'kawasaki-frontale' },
  { name: 'KFUM Oslo', slug: 'kfum-oslo' },
  { name: 'Kilmarnock', slug: 'kilmarnock' },
  { name: 'Kristiansund', slug: 'kristiansund' },
  { name: 'Kyoto Sanga', slug: 'kyoto-sanga' },
  { name: 'LA Galaxy', slug: 'la-galaxy' },
  { name: 'LAFC', slug: 'lafc' },
  { name: 'Lanús', slug: 'lanus' },
  { name: 'Las Vegas Lights', slug: 'las-vegas-lights' },
  { name: 'Lazio', slug: 'lazio' },
  { name: 'Le Havre', slug: 'le-havre' },
  { name: 'Le Mans', slug: 'le-mans' },
  { name: 'Leeds United', slug: 'leeds-united' },
  { name: 'Leicester City', slug: 'leicester-city' },
  { name: 'Lens', slug: 'lens' },
  { name: 'León', slug: 'leon' },
  { name: 'Lexington SC', slug: 'lexington-sc' },
  { name: 'Liberia', slug: 'liberia' },
  { name: 'Lille', slug: 'lille' },
  { name: 'Lillestrøm', slug: 'lillestrom' },
  { name: 'Limón', slug: 'limon' },
  { name: 'Liverpool', slug: 'liverpool' },
  { name: 'Livingston', slug: 'livingston' },
  { name: 'Lorient', slug: 'lorient' },
  { name: 'Loudoun United', slug: 'loudoun-united' },
  { name: 'Louisville City', slug: 'louisville-city' },
  { name: 'Lyngby', slug: 'lyngby' },
  { name: 'Lyon', slug: 'lyon' },
  { name: 'Machida Zelvia', slug: 'machida-zelvia' },
  { name: 'Mainz', slug: 'mainz' },
  { name: 'Malmö FF', slug: 'malmo' },
  { name: 'Manchester City', slug: 'manchester-city' },
  { name: 'Manchester United', slug: 'manchester-united' },
  { name: 'Marseille', slug: 'marseille' },
  { name: 'Mazatlán', slug: 'mazatlan' },
  { name: 'Metz', slug: 'metz' },
  { name: 'Miami FC', slug: 'miami-fc' },
  { name: 'Midtjylland', slug: 'midtjylland' },
  { name: 'Minnesota United', slug: 'minnesota-united' },
  { name: 'Mirassol', slug: 'mirassol' },
  { name: 'Mito Hollyhock', slug: 'mito-hollyhock' },
  { name: 'Mjällby', slug: 'mjallby' },
  { name: 'Molde', slug: 'molde' },
  { name: 'Monaco', slug: 'monaco' },
  { name: 'Monterey Bay', slug: 'monterey-bay' },
  { name: 'Monterrey', slug: 'monterrey' },
  { name: 'Montpellier', slug: 'montpellier' },
  { name: 'Motherwell', slug: 'motherwell' },
  { name: 'Municipal Grecia', slug: 'grecia' },
  { name: 'NAC Breda', slug: 'nac-breda' },
  { name: 'Nagoya Grampus', slug: 'nagoya-grampus' },
  { name: 'Nancy', slug: 'nancy' },
  { name: 'Nantes', slug: 'nantes' },
  { name: 'Napoli', slug: 'napoli' },
  { name: 'Nashville SC', slug: 'nashville-sc' },
  { name: 'NEC Nijmegen', slug: 'nec' },
  { name: 'Necaxa', slug: 'necaxa' },
  { name: 'New England', slug: 'new-england' },
  { name: 'New Mexico United', slug: 'new-mexico-united' },
  { name: 'Newcastle', slug: 'newcastle' },
  { name: 'Newell\'s Old Boys', slug: 'newells' },
  { name: 'Nice', slug: 'nice' },
  { name: 'Nîmes', slug: 'nimes' },
  { name: 'Nordsjælland', slug: 'nordsjaelland' },
  { name: 'NY Red Bulls', slug: 'ny-red-bulls' },
  { name: 'NYCFC', slug: 'nycfc' },
  { name: 'Oakland Roots', slug: 'oakland-roots' },
  { name: 'OB Odense', slug: 'ob-odense' },
  { name: 'Odd', slug: 'odd' },
  { name: 'Olympiacos', slug: 'olympiacos' },
  { name: 'Orange County SC', slug: 'orange-county-sc' },
  { name: 'Örebro', slug: 'orebro' },
  { name: 'Orlando City', slug: 'orlando-city' },
  { name: 'Pachuca', slug: 'pachuca' },
  { name: 'Palmeiras', slug: 'palmeiras' },
  { name: 'Paris FC', slug: 'paris-fc' },
  { name: 'Paris Saint-Germain', slug: 'psg' },
  { name: 'PEC Zwolle', slug: 'pec-zwolle' },
  { name: 'Pérez Zeledón', slug: 'perez-zeledon' },
  { name: 'Philadelphia Union', slug: 'philadelphia-union' },
  { name: 'Phoenix Rising', slug: 'phoenix-rising' },
  { name: 'Pittsburgh Riverhounds', slug: 'pittsburgh-riverhounds' },
  { name: 'Platense', slug: 'platense' },
  { name: 'Pohang Steelers', slug: 'pohang-steelers' },
  { name: 'Portland Timbers', slug: 'portland-timbers' },
  { name: 'Porto', slug: 'porto' },
  { name: 'PSV', slug: 'psv' },
  { name: 'Puebla', slug: 'puebla' },
  { name: 'Pumas', slug: 'pumas' },
  { name: 'Puntarenas', slug: 'puntarenas' },
  { name: 'Querétaro', slug: 'queretaro' },
  { name: 'Racing', slug: 'racing' },
  { name: 'Randers', slug: 'randers' },
  { name: 'Rangers', slug: 'rangers' },
  { name: 'RB Leipzig', slug: 'rb-leipzig' },
  { name: 'Real Madrid', slug: 'real-madrid' },
  { name: 'Real Salt Lake', slug: 'real-salt-lake' },
  { name: 'Red Star Belgrade', slug: 'red-star' },
  { name: 'Reims', slug: 'reims' },
  { name: 'Rennes', slug: 'rennes' },
  { name: 'Rhode Island FC', slug: 'rhode-island-fc' },
  { name: 'River Plate', slug: 'river-plate' },
  { name: 'RKC Waalwijk', slug: 'rkc' },
  { name: 'Roma', slug: 'roma' },
  { name: 'Rosario Central', slug: 'rosario-central' },
  { name: 'Rosenborg', slug: 'rosenborg' },
  { name: 'Sacramento Republic', slug: 'sacramento-republic' },
  { name: 'Saint-Étienne', slug: 'saint-etienne' },
  { name: 'San Antonio FC', slug: 'san-antonio-fc' },
  { name: 'San Carlos', slug: 'san-carlos' },
  { name: 'San Diego FC', slug: 'san-diego-fc' },
  { name: 'San Jose Earthquakes', slug: 'san-jose-earthquakes' },
  { name: 'San Lorenzo', slug: 'san-lorenzo' },
  { name: 'Sanfrecce Hiroshima', slug: 'sanfrecce-hiroshima' },
  { name: 'Santos', slug: 'santos' },
  { name: 'Santos de Guápiles', slug: 'santos-guapiles' },
  { name: 'Santos Laguna', slug: 'santos-laguna' },
  { name: 'São Paulo', slug: 'sao-paulo' },
  { name: 'Saprissa', slug: 'saprissa' },
  { name: 'Sarpsborg', slug: 'sarpsborg' },
  { name: 'Schalke', slug: 'schalke' },
  { name: 'Seattle Sounders', slug: 'seattle-sounders' },
  { name: 'Sevilla', slug: 'sevilla' },
  { name: 'Shakhtar', slug: 'shakhtar' },
  { name: 'Shimizu S-Pulse', slug: 'shimizu-s-pulse' },
  { name: 'Silkeborg', slug: 'silkeborg' },
  { name: 'Sirius', slug: 'sirius' },
  { name: 'Sochaux', slug: 'sochaux' },
  { name: 'Sønderjyske', slug: 'sonderjyske' },
  { name: 'Sparta Rotterdam', slug: 'sparta-rotterdam' },
  { name: 'Sport Recife', slug: 'sport-recife' },
  { name: 'Sporting', slug: 'sporting' },
  { name: 'Sporting Jax', slug: 'sporting-jax' },
  { name: 'Sporting KC', slug: 'sporting-kc' },
  { name: 'Sporting San José', slug: 'sporting-san-jose' },
  { name: 'St Mirren', slug: 'st-mirren' },
  { name: 'St. Louis City', slug: 'st-louis-city' },
  { name: 'St. Pauli', slug: 'st-pauli' },
  { name: 'Stabæk', slug: 'stabaek' },
  { name: 'Strasbourg', slug: 'strasbourg' },
  { name: 'Strømsgodset', slug: 'stromsgodset' },
  { name: 'Stuttgart', slug: 'stuttgart' },
  { name: 'Switchbacks', slug: 'switchbacks' },
  { name: 'Talleres', slug: 'talleres' },
  { name: 'Tampa Bay Rowdies', slug: 'tampa-bay-rowdies' },
  { name: 'Tigre', slug: 'tigre' },
  { name: 'Tigres', slug: 'tigres' },
  { name: 'Tijuana', slug: 'tijuana' },
  { name: 'Tokyo Verdy', slug: 'tokyo-verdy' },
  { name: 'Toluca', slug: 'toluca' },
  { name: 'Toronto FC', slug: 'toronto-fc' },
  { name: 'Tottenham', slug: 'tottenham' },
  { name: 'Toulouse', slug: 'toulouse' },
  { name: 'Tromsø', slug: 'tromso' },
  { name: 'Troyes', slug: 'troyes' },
  { name: 'Twente', slug: 'twente' },
  { name: 'Ulsan HD', slug: 'ulsan-hd' },
  { name: 'Unión', slug: 'union' },
  { name: 'Union Berlin', slug: 'union-berlin' },
  { name: 'Urawa Reds', slug: 'urawa-reds' },
  { name: 'Utrecht', slug: 'utrecht' },
  { name: 'V-Varen Nagasaki', slug: 'v-varen-nagasaki' },
  { name: 'Valencia', slug: 'valencia' },
  { name: 'Vålerenga', slug: 'valerenga' },
  { name: 'Vancouver Whitecaps', slug: 'vancouver-whitecaps' },
  { name: 'Värnamo', slug: 'varnamo' },
  { name: 'Vasco da Gama', slug: 'vasco' },
  { name: 'Vejle', slug: 'vejle' },
  { name: 'Vélez Sarsfield', slug: 'velez' },
  { name: 'Viborg', slug: 'viborg' },
  { name: 'Viking', slug: 'viking' },
  { name: 'Vissel Kobe', slug: 'vissel-kobe' },
  { name: 'Vitesse', slug: 'vitesse' },
  { name: 'Vitória', slug: 'vitoria' },
  { name: 'Volendam', slug: 'volendam' },
  { name: 'Werder Bremen', slug: 'werder-bremen' },
  { name: 'West Ham', slug: 'west-ham' },
  { name: 'Willem II', slug: 'willem-ii' },
  { name: 'Wolfsburg', slug: 'wolfsburg' },
  { name: 'Yokohama Marinos', slug: 'yokohama-marinos' },
] as const;

export const FAMOUS_SOCCER_TEAMS: readonly TeamName[] =
  FAMOUS_SOCCER_TEAM_SEEDS.map(withMeta);

/** Resolve toast-ready club info from a thread title or worktree slug. */
export function lookupSoccerTeam(titleOrSlug: string): TeamName | null {
  const trimmed = titleOrSlug.trim();
  if (!trimmed) return null;
  const fromName = teamSlugFromName(trimmed);
  const slug = fromName ?? normalizeTakenSlug(trimmed);
  const baseSlug = slug.replace(/-\d+$/, '');
  const seed = FAMOUS_SOCCER_TEAM_SEEDS.find((t) => t.slug === baseSlug);
  if (!seed) return null;
  const suffixMatch = slug.match(/-(\d+)$/) || trimmed.match(/\s+(\d+)$/);
  const suffix = suffixMatch?.[1];
  return withMeta({
    name: suffix ? `${seed.name} ${suffix}` : seed.name,
    slug: suffix ? `${seed.slug}-${suffix}` : seed.slug,
  });
}

/** Human-readable label for a worktree dir / `thread/<slug>` branch. */
export function teamNameFromSlug(slug: string): string {
  const normalized = slug.toLowerCase().replace(/^thread\//, '');
  const suffixMatch = normalized.match(/^(.+)-(\d+)$/);
  const base = suffixMatch?.[1] ?? normalized;
  const suffix = suffixMatch?.[2];
  const team = FAMOUS_SOCCER_TEAM_SEEDS.find((t) => t.slug === base);
  if (team) return suffix ? `${team.name} ${suffix}` : team.name;
  return normalized
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/** Reverse of `teamNameFromSlug` for known clubs (incl. numeric suffixes). */
export function teamSlugFromName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const suffixMatch = trimmed.match(/^(.+?)\s+(\d+)$/);
  const baseName = suffixMatch?.[1] ?? trimmed;
  const suffix = suffixMatch?.[2];
  const team = FAMOUS_SOCCER_TEAM_SEEDS.find(
    (t) => t.name.toLowerCase() === baseName.toLowerCase(),
  );
  if (!team) return null;
  return suffix ? `${team.slug}-${suffix}` : team.slug;
}

/** Normalize a branch/dir/title token into a comparable taken slug. */
export function normalizeTakenSlug(raw: string): string {
  return raw.toLowerCase().replace(/^thread\//, '').replace(/\/+$/, '');
}

/**
 * Slugs that should count as "already used" for a thread record — title (when
 * it maps to a club), placeholder branch, and worktree directory name.
 */
export function takenSlugsFromThread(thread: {
  title?: string | null;
  branchName?: string | null;
  worktreePath?: string | null;
}): string[] {
  const out = new Set<string>();
  const titleSlug = thread.title ? teamSlugFromName(thread.title) : null;
  if (titleSlug) out.add(normalizeTakenSlug(titleSlug));

  if (thread.branchName?.trim()) {
    const branch = normalizeTakenSlug(thread.branchName.trim());
    if (branch) out.add(branch);
  }

  if (thread.worktreePath) {
    const parts = thread.worktreePath.replace(/\/+$/, '').split('/');
    const dir = parts[parts.length - 1];
    if (dir) out.add(normalizeTakenSlug(dir));
  }

  return [...out];
}

export function allocateTeamName(
  taken: Iterable<string>,
  random: () => number = Math.random,
): TeamName {
  const takenSet = new Set(
    [...taken].map((s) => normalizeTakenSlug(s)).filter(Boolean),
  );
  const available = FAMOUS_SOCCER_TEAM_SEEDS.filter((t) => !takenSet.has(t.slug));
  if (available.length > 0) {
    const idx = Math.floor(random() * available.length);
    return withMeta(available[idx]!);
  }

  for (let n = 2; n < 1000; n++) {
    for (const t of FAMOUS_SOCCER_TEAM_SEEDS) {
      const slug = `${t.slug}-${n}`;
      if (!takenSet.has(slug)) {
        return withMeta({ name: `${t.name} ${n}`, slug });
      }
    }
  }

  throw new Error('No available soccer team names left');
}
