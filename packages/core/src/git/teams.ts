/**
 * Memorable worktree / thread labels (Conductor-style nicknames).
 * Slug is the directory + `thread/<slug>` branch; `name` is the UI title.
 */
export interface TeamName {
  name: string;
  slug: string;
}

/** Famous soccer clubs — short, recognizable thread labels. */
export const FAMOUS_SOCCER_TEAMS: readonly TeamName[] = [
  { name: 'Aberdeen', slug: 'aberdeen' },
  { name: 'Ajax', slug: 'ajax' },
  { name: 'Al Ahly', slug: 'al-ahly' },
  { name: 'Al Hilal', slug: 'al-hilal' },
  { name: 'Angers', slug: 'angers' },
  { name: 'Anyang', slug: 'anyang' },
  { name: 'Arsenal', slug: 'arsenal' },
  { name: 'Aston Villa', slug: 'aston-villa' },
  { name: 'Atlanta United', slug: 'atlanta-united' },
  { name: 'Atlas', slug: 'atlas' },
  { name: 'Atlético Madrid', slug: 'atletico-madrid' },
  { name: 'Atlético San Luis', slug: 'atletico-san-luis' },
  { name: 'Augsburg', slug: 'augsburg' },
  { name: 'Austin FC', slug: 'austin-fc' },
  { name: 'Auxerre', slug: 'auxerre' },
  { name: 'Avispa Fukuoka', slug: 'avispa-fukuoka' },
  { name: 'Barcelona', slug: 'barcelona' },
  { name: 'Bayer Leverkusen', slug: 'bayer-leverkusen' },
  { name: 'Bayern Munich', slug: 'bayern-munich' },
  { name: 'Benfica', slug: 'benfica' },
  { name: 'Birmingham Legion', slug: 'birmingham-legion' },
  { name: 'Boca Juniors', slug: 'boca-juniors' },
  { name: 'Borussia Dortmund', slug: 'borussia-dortmund' },
  { name: 'Brest', slug: 'brest' },
  { name: 'Brooklyn FC', slug: 'brooklyn-fc' },
  { name: 'Bucheon', slug: 'bucheon' },
  { name: 'Celtic', slug: 'celtic' },
  { name: 'Cerezo Osaka', slug: 'cerezo-osaka' },
  { name: 'CF Montréal', slug: 'cf-montreal' },
  { name: 'Charleston Battery', slug: 'charleston-battery' },
  { name: 'Charlotte FC', slug: 'charlotte-fc' },
  { name: 'Chelsea', slug: 'chelsea' },
  { name: 'Chicago Fire', slug: 'chicago-fire' },
  { name: 'Chivas', slug: 'chivas' },
  { name: 'Club América', slug: 'club-america' },
  { name: 'Cologne', slug: 'cologne' },
  { name: 'Colorado Rapids', slug: 'colorado-rapids' },
  { name: 'Columbus Crew', slug: 'columbus-crew' },
  { name: 'Corinthians', slug: 'corinthians' },
  { name: 'Cruz Azul', slug: 'cruz-azul' },
  { name: 'Daejeon', slug: 'daejeon' },
  { name: 'DC United', slug: 'dc-united' },
  { name: 'Detroit City', slug: 'detroit-city' },
  { name: 'Dundee', slug: 'dundee' },
  { name: 'Dundee United', slug: 'dundee-united' },
  { name: 'Dynamo Kyiv', slug: 'dynamo-kyiv' },
  { name: 'Eintracht Frankfurt', slug: 'eintracht-frankfurt' },
  { name: 'El Paso Locomotive', slug: 'el-paso-locomotive' },
  { name: 'Everton', slug: 'everton' },
  { name: 'Fagiano Okayama', slug: 'fagiano-okayama' },
  { name: 'Falkirk', slug: 'falkirk' },
  { name: 'FC Cincinnati', slug: 'fc-cincinnati' },
  { name: 'FC Dallas', slug: 'fc-dallas' },
  { name: 'FC Seoul', slug: 'fc-seoul' },
  { name: 'FC Tokyo', slug: 'fc-tokyo' },
  { name: 'FC Tulsa', slug: 'fc-tulsa' },
  { name: 'Feyenoord', slug: 'feyenoord' },
  { name: 'Flamengo', slug: 'flamengo' },
  { name: 'Fluminense', slug: 'fluminense' },
  { name: 'Freiburg', slug: 'freiburg' },
  { name: 'Galatasaray', slug: 'galatasaray' },
  { name: 'Gamba Osaka', slug: 'gamba-osaka' },
  { name: 'Gangwon', slug: 'gangwon' },
  { name: 'Gimcheon Sangmu', slug: 'gimcheon-sangmu' },
  { name: 'Gladbach', slug: 'gladbach' },
  { name: 'Gwangju', slug: 'gwangju' },
  { name: 'Hamburg', slug: 'hamburg' },
  { name: 'Hartford Athletic', slug: 'hartford-athletic' },
  { name: 'Hearts', slug: 'hearts' },
  { name: 'Heidenheim', slug: 'heidenheim' },
  { name: 'Hibernian', slug: 'hibernian' },
  { name: 'Hoffenheim', slug: 'hoffenheim' },
  { name: 'Houston Dynamo', slug: 'houston-dynamo' },
  { name: 'Incheon United', slug: 'incheon-united' },
  { name: 'Indy Eleven', slug: 'indy-eleven' },
  { name: 'Inter Miami', slug: 'inter-miami' },
  { name: 'Inter Milan', slug: 'inter-milan' },
  { name: 'JEF United', slug: 'jef-united' },
  { name: 'Jeju SK', slug: 'jeju-sk' },
  { name: 'Jeonbuk', slug: 'jeonbuk' },
  { name: 'Juárez', slug: 'juarez' },
  { name: 'Juventus', slug: 'juventus' },
  { name: 'Kashima Antlers', slug: 'kashima-antlers' },
  { name: 'Kashiwa Reysol', slug: 'kashiwa-reysol' },
  { name: 'Kawasaki Frontale', slug: 'kawasaki-frontale' },
  { name: 'Kilmarnock', slug: 'kilmarnock' },
  { name: 'Kyoto Sanga', slug: 'kyoto-sanga' },
  { name: 'LA Galaxy', slug: 'la-galaxy' },
  { name: 'LAFC', slug: 'lafc' },
  { name: 'Las Vegas Lights', slug: 'las-vegas-lights' },
  { name: 'Lazio', slug: 'lazio' },
  { name: 'Le Havre', slug: 'le-havre' },
  { name: 'Leeds United', slug: 'leeds-united' },
  { name: 'Leicester City', slug: 'leicester-city' },
  { name: 'Lens', slug: 'lens' },
  { name: 'León', slug: 'leon' },
  { name: 'Lexington SC', slug: 'lexington-sc' },
  { name: 'Lille', slug: 'lille' },
  { name: 'Liverpool', slug: 'liverpool' },
  { name: 'Livingston', slug: 'livingston' },
  { name: 'Lorient', slug: 'lorient' },
  { name: 'Loudoun United', slug: 'loudoun-united' },
  { name: 'Louisville City', slug: 'louisville-city' },
  { name: 'Lyon', slug: 'lyon' },
  { name: 'Machida Zelvia', slug: 'machida-zelvia' },
  { name: 'Mainz', slug: 'mainz' },
  { name: 'Manchester City', slug: 'manchester-city' },
  { name: 'Manchester United', slug: 'manchester-united' },
  { name: 'Marseille', slug: 'marseille' },
  { name: 'Mazatlán', slug: 'mazatlan' },
  { name: 'Metz', slug: 'metz' },
  { name: 'Miami FC', slug: 'miami-fc' },
  { name: 'AC Milan', slug: 'ac-milan' },
  { name: 'Minnesota United', slug: 'minnesota-united' },
  { name: 'Mito Hollyhock', slug: 'mito-hollyhock' },
  { name: 'Monaco', slug: 'monaco' },
  { name: 'Monterey Bay', slug: 'monterey-bay' },
  { name: 'Monterrey', slug: 'monterrey' },
  { name: 'Motherwell', slug: 'motherwell' },
  { name: 'Nagoya Grampus', slug: 'nagoya-grampus' },
  { name: 'Nantes', slug: 'nantes' },
  { name: 'Napoli', slug: 'napoli' },
  { name: 'Nashville SC', slug: 'nashville-sc' },
  { name: 'Necaxa', slug: 'necaxa' },
  { name: 'New England', slug: 'new-england' },
  { name: 'New Mexico United', slug: 'new-mexico-united' },
  { name: 'Newcastle', slug: 'newcastle' },
  { name: 'Nice', slug: 'nice' },
  { name: 'NY Red Bulls', slug: 'ny-red-bulls' },
  { name: 'NYCFC', slug: 'nycfc' },
  { name: 'Oakland Roots', slug: 'oakland-roots' },
  { name: 'Olympiacos', slug: 'olympiacos' },
  { name: 'Orange County SC', slug: 'orange-county-sc' },
  { name: 'Orlando City', slug: 'orlando-city' },
  { name: 'Pachuca', slug: 'pachuca' },
  { name: 'Palmeiras', slug: 'palmeiras' },
  { name: 'Paris FC', slug: 'paris-fc' },
  { name: 'Paris Saint-Germain', slug: 'psg' },
  { name: 'Philadelphia Union', slug: 'philadelphia-union' },
  { name: 'Phoenix Rising', slug: 'phoenix-rising' },
  { name: 'Pittsburgh Riverhounds', slug: 'pittsburgh-riverhounds' },
  { name: 'Pohang Steelers', slug: 'pohang-steelers' },
  { name: 'Portland Timbers', slug: 'portland-timbers' },
  { name: 'Porto', slug: 'porto' },
  { name: 'PSV', slug: 'psv' },
  { name: 'Puebla', slug: 'puebla' },
  { name: 'Pumas', slug: 'pumas' },
  { name: 'Querétaro', slug: 'queretaro' },
  { name: 'Rangers', slug: 'rangers' },
  { name: 'RB Leipzig', slug: 'rb-leipzig' },
  { name: 'Real Madrid', slug: 'real-madrid' },
  { name: 'Real Salt Lake', slug: 'real-salt-lake' },
  { name: 'Red Star Belgrade', slug: 'red-star' },
  { name: 'Rennes', slug: 'rennes' },
  { name: 'Rhode Island FC', slug: 'rhode-island-fc' },
  { name: 'River Plate', slug: 'river-plate' },
  { name: 'Roma', slug: 'roma' },
  { name: 'Sacramento Republic', slug: 'sacramento-republic' },
  { name: 'San Antonio FC', slug: 'san-antonio-fc' },
  { name: 'San Diego FC', slug: 'san-diego-fc' },
  { name: 'San Jose Earthquakes', slug: 'san-jose-earthquakes' },
  { name: 'Sanfrecce Hiroshima', slug: 'sanfrecce-hiroshima' },
  { name: 'Santos', slug: 'santos' },
  { name: 'Santos Laguna', slug: 'santos-laguna' },
  { name: 'São Paulo', slug: 'sao-paulo' },
  { name: 'Schalke', slug: 'schalke' },
  { name: 'Seattle Sounders', slug: 'seattle-sounders' },
  { name: 'Sevilla', slug: 'sevilla' },
  { name: 'Shakhtar', slug: 'shakhtar' },
  { name: 'Shimizu S-Pulse', slug: 'shimizu-s-pulse' },
  { name: 'Sporting', slug: 'sporting' },
  { name: 'Sporting Jax', slug: 'sporting-jax' },
  { name: 'Sporting KC', slug: 'sporting-kc' },
  { name: 'St Mirren', slug: 'st-mirren' },
  { name: 'St. Louis City', slug: 'st-louis-city' },
  { name: 'St. Pauli', slug: 'st-pauli' },
  { name: 'Strasbourg', slug: 'strasbourg' },
  { name: 'Stuttgart', slug: 'stuttgart' },
  { name: 'Switchbacks', slug: 'switchbacks' },
  { name: 'Tampa Bay Rowdies', slug: 'tampa-bay-rowdies' },
  { name: 'Tigres', slug: 'tigres' },
  { name: 'Tijuana', slug: 'tijuana' },
  { name: 'Tokyo Verdy', slug: 'tokyo-verdy' },
  { name: 'Toluca', slug: 'toluca' },
  { name: 'Toronto FC', slug: 'toronto-fc' },
  { name: 'Tottenham', slug: 'tottenham' },
  { name: 'Toulouse', slug: 'toulouse' },
  { name: 'Ulsan HD', slug: 'ulsan-hd' },
  { name: 'Union Berlin', slug: 'union-berlin' },
  { name: 'Urawa Reds', slug: 'urawa-reds' },
  { name: 'Valencia', slug: 'valencia' },
  { name: 'Vancouver Whitecaps', slug: 'vancouver-whitecaps' },
  { name: 'V-Varen Nagasaki', slug: 'v-varen-nagasaki' },
  { name: 'Vissel Kobe', slug: 'vissel-kobe' },
  { name: 'Werder Bremen', slug: 'werder-bremen' },
  { name: 'West Ham', slug: 'west-ham' },
  { name: 'Wolfsburg', slug: 'wolfsburg' },
  { name: 'Yokohama Marinos', slug: 'yokohama-marinos' },
] as const;

/** Human-readable label for a worktree dir / `thread/<slug>` branch. */
export function teamNameFromSlug(slug: string): string {
  const normalized = slug.toLowerCase().replace(/^thread\//, '');
  const suffixMatch = normalized.match(/^(.+)-(\d+)$/);
  const base = suffixMatch?.[1] ?? normalized;
  const suffix = suffixMatch?.[2];
  const team = FAMOUS_SOCCER_TEAMS.find((t) => t.slug === base);
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
  const team = FAMOUS_SOCCER_TEAMS.find(
    (t) => t.name.toLowerCase() === baseName.toLowerCase(),
  );
  if (!team) return null;
  return suffix ? `${team.slug}-${suffix}` : team.slug;
}

export function allocateTeamName(
  taken: Iterable<string>,
  random: () => number = Math.random,
): TeamName {
  const takenSet = new Set(
    [...taken].map((s) => s.toLowerCase().replace(/^thread\//, '')),
  );
  const available = FAMOUS_SOCCER_TEAMS.filter((t) => !takenSet.has(t.slug));
  if (available.length > 0) {
    const idx = Math.floor(random() * available.length);
    return available[idx]!;
  }

  for (let n = 2; n < 1000; n++) {
    for (const t of FAMOUS_SOCCER_TEAMS) {
      const slug = `${t.slug}-${n}`;
      if (!takenSet.has(slug)) {
        return { name: `${t.name} ${n}`, slug };
      }
    }
  }

  throw new Error('No available soccer team names left');
}
