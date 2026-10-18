// Artifact-substat optimiser for ONE character.
//
// WHY THIS IS NOT IN THE APP
//   The search is over the legal substat ROLL allocations of five pieces. The
//   damage cannot tell two layouts with the same per-stat roll totals apart, so
//   the engine merges its rows ONCE (see src/lib/merged-expression.js) into a
//   polynomial of the panel, and this program does the rest: enumerate, evaluate,
//   drop duplicates, sort.
//
// WHAT IT KNOWS
//   Nothing about Genshin. It reads a plain text problem -- a baseline panel, the
//   merged coefficients, what ONE roll of each substat is worth, and the SHAPE of
//   each piece -- and writes a CSV.
//
// INPUT FORMAT (whitespace-separated; '#' starts a comment)
//   panel   <atk> <atkPct> <flatAtk> <critRate> <critDmg> <anemoDmg> <pyroDmg> <dmgBonus> <em>
//   hit     <statKey> <valuePerRoll>       # declares a substat; column order follows this order
//   piece   <slotKey> <lines> <rolls> <maxPerLine>
//   allow   <slotKey> <statKey> <state>    # state 2 = MUST sit on this piece, 1 = may sit on it
//   coeff   never <16 numbers>
//   coeff   crit  <16 numbers>
//   group   <critRateBuff> <16 numbers>    # avg = never + sum min(R + buff, 100)/100 * group
//   amp     never <emBuff> <16 numbers>    # polynomial part of an amplifying reaction
//   amp     crit  <emBuff> <16 numbers>
//   amp     group <critRateBuff> <emBuff> <16 numbers>
//   ref     <A> <C> <R> <E>                # optional: the CURRENT build, emitted last
//
// THE SHAPE OF A PIECE, WHICH IS THE WHOLE POINT
//   A 5-star piece at +20 carries EXACTLY four substats and spends exactly nine
//   rolls on them: four affixes (one roll each, the ones it is born with) plus five
//   upgrades. Every affix exists, so every line takes at least one roll, and no line
//   can take more than six (its initial roll plus all five upgrades).
//
//       lines <= rolls <= lines * maxPerLine,  one roll minimum on every line
//
//   The first version of this program had no such rule. It spent a global hit
//   budget over per-stat caps instead, so it happily put every roll into CRIT DMG
//   and left the other three lines of a piece EMPTY -- an allocation no artifact can
//   have -- and then reported it as the optimum. The rule is now structural: a
//   candidate is a SET of lines plus a distribution over them, so the search can
//   only reach panels a real build reaches.
//
//   Main-stat exclusion is the caller's job ('allow' simply omits the main stat of
//   the slot), because this program does not know that a plume is always flat ATK.
//
// HOW THE SEARCH IS KEPT SMALL
//   ATK%, flat ATK, CRIT Rate and CRIT DMG always move the panel; EM moves it too
//   when an amplifying reaction is present. The rest spend a line and change no
//   number. A piece's contribution is therefore a small-dimensional roll count,
//   and pieces are combined level by level with a
//   dedupe on that count -- a state that has been reached is never expanded twice,
//   and the count of reachable states is in the tens of thousands rather than the
//   billions a per-branch walk would visit.
//
// MONOMIAL ORDER (fixed, 16 wide)
//   1 U P G C U*C P*C G*C  A A*U A*P A*G A*C A*U*C A*P*C A*G*C
//
// OUTPUT
//   CSV on stdout: one row per DISTINCT (A, C, R, E) outcome, sorted by expected
//   damage, with the three crit conventions and the ROLL COUNT per substat that
//   reaches it.

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace {

constexpr int MONO = 16;
// Substats one problem may declare. Ten exist in the game; the slack is room.
constexpr int MAX_STATS = 16;
// Bits one feeding dimension takes in a packed roll count.
constexpr int FEED_BITS = 12;

/*
 * Which panel quantity a substat moves, or -1 for one that moves nothing.
 *
 * The ORDER is the packing order of the packed key, so it is part of the format
 * rather than a private detail: five dimensions need FEED_BITS * 5 <= 64.
 */
int feedDimOf(const std::string& key) {
  if (key == "atkPct") return 0;
  if (key == "atk") return 1;
  if (key == "critRate") return 2;
  if (key == "critDmg") return 3;
  if (key == "em") return 4;
  return -1;
}

struct Problem {
  double atk = 0, atkPct = 0, flatAtk = 0, critRate = 0, critDmg = 0;
  double anemoDmg = 0, pyroDmg = 0, dmgBonus = 0;
  double em = 0;

  std::vector<std::string> keys;          // declared substats, in column order
  std::array<int, MAX_STATS> feed{};      // -1, or the dimension the stat feeds
  std::array<double, MAX_STATS> value{};  // what one roll of the stat is worth

  struct Allow { std::string slot; int stat = -1; int state = 1; };

  struct Piece {
    std::string slot;
    int lines = 4, rolls = 9, maxPerLine = 6;
    std::vector<int> allowed;   // stat indices, declaration order
    std::vector<int> required;  // a subset of 'allowed'
  };

  std::vector<Allow> allows;
  std::vector<Piece> pieces;

  std::array<double, MONO> never{};
  std::array<double, MONO> crit{};
  struct Amp { double emBuff = 0; std::array<double, MONO> coeffs{}; };
  struct Group {
    double crBuff = 0;
    std::array<double, MONO> delta{};
    std::vector<Amp> amp;
  };
  std::vector<Amp> ampNever;
  std::vector<Amp> ampCrit;
  std::vector<Group> groups;

  bool hasRef = false;
  double refA = 0, refC = 0, refR = 0, refE = 0;

  int indexOf(const std::string& key) const {
    for (size_t i = 0; i < keys.size(); ++i) if (keys[i] == key) return (int)i;
    return -1;
  }

  Piece* pieceOf(const std::string& slot) {
    for (auto& pc : pieces) if (pc.slot == slot) return &pc;
    return nullptr;
  }
};

// The fixed monomial order, expanded.
inline double evalCoeffs(const std::array<double, MONO>& c,
                         double A, double U, double P, double G, double C) {
  return c[0]
       + c[1] * U + c[2] * P + c[3] * G + c[4] * C
       + c[5] * U * C + c[6] * P * C + c[7] * G * C
       + A * (c[8]
              + c[9] * U + c[10] * P + c[11] * G + c[12] * C
              + c[13] * U * C + c[14] * P * C + c[15] * G * C);
}

inline double emFactor(double em) {
  return 1.0 + (2.78 * em) / (em + 1400.0);
}

inline double evalAmp(const std::vector<Problem::Amp>& groups,
                      double E, double A, double U, double P, double G, double C) {
  double sum = 0;
  for (const auto& g : groups) {
    sum += emFactor(E + g.emBuff) * evalCoeffs(g.coeffs, A, U, P, G, C);
  }
  return sum;
}

bool hasAmp(const Problem& p) {
  const auto any = [](const std::vector<Problem::Amp>& list) {
    for (const auto& a : list) {
      for (double x : a.coeffs) if (x != 0) return true;
    }
    return false;
  };
  if (any(p.ampNever) || any(p.ampCrit)) return true;
  for (const auto& g : p.groups) if (any(g.amp)) return true;
  return false;
}

template <typename... Args>
bool take(std::istringstream& is, Args&... args) {
  return (static_cast<bool>(is >> args) && ...);
}

bool readProblem(const char* path, Problem& p, std::string& err) {
  p.feed.fill(-1);
  std::ifstream in(path);
  if (!in) { err = "cannot open problem file"; return false; }
  const auto readVector = [](std::istringstream& is, std::array<double, MONO>& dst) {
    for (double& x : dst) if (!(is >> x)) return false;
    return true;
  };
  const auto groupOf = [&p](double crBuff) -> Problem::Group* {
    for (auto& g : p.groups) if (std::abs(g.crBuff - crBuff) < 1e-9) return &g;
    return nullptr;
  };
  std::string line;
  while (std::getline(in, line)) {
    const auto hash = line.find('#');
    if (hash != std::string::npos) line.erase(hash);
    std::istringstream is(line);
    std::string kind;
    if (!(is >> kind)) continue;

    if (kind == "panel") {
      if (!take(is, p.atk, p.atkPct, p.flatAtk, p.critRate, p.critDmg,
                p.anemoDmg, p.pyroDmg, p.dmgBonus)) {
        err = "panel: expected 8 numbers";
        return false;
      }
      // EM was appended to the format; an older eight-number problem is still
      // readable and simply has no reaction EM.
      if (!(is >> p.em)) p.em = 0;
    } else if (kind == "hit") {
      std::string key; double v = 0;
      if (!take(is, key, v)) { err = "hit: expected a key and a value"; return false; }
      const int at = p.indexOf(key);
      if (at >= 0) { p.value[at] = v; continue; }
      if ((int)p.keys.size() >= MAX_STATS) { err = "too many substats declared"; return false; }
      p.feed[p.keys.size()] = feedDimOf(key);
      p.value[p.keys.size()] = v;
      p.keys.push_back(key);
    } else if (kind == "piece") {
      Problem::Piece pc;
      if (!take(is, pc.slot, pc.lines, pc.rolls, pc.maxPerLine)) {
        err = "piece: expected slot, lines, rolls and maxPerLine";
        return false;
      }
      if (pc.slot.empty()) { err = "piece needs a slot name"; return false; }
      if (!p.pieceOf(pc.slot)) p.pieces.push_back(pc);
    } else if (kind == "allow") {
      Problem::Allow a;
      std::string key;
      if (!take(is, a.slot, key, a.state)) {
        err = "allow: expected slot, stat and state";
        return false;
      }
      a.stat = p.indexOf(key);
      if (a.stat < 0) { err = "allow names an undeclared substat: " + key; return false; }
      p.allows.push_back(a);
    } else if (kind == "coeff") {
      std::string which; is >> which;
      std::array<double, MONO>* dst =
          which == "never" ? &p.never : which == "crit" ? &p.crit : nullptr;
      if (!dst) { err = "coeff must be never|crit"; return false; }
      if (!readVector(is, *dst)) { err = "coeff: expected 16 numbers"; return false; }
    } else if (kind == "group") {
      Problem::Group g{};
      if (!take(is, g.crBuff)) { err = "group: expected a crit-rate buff"; return false; }
      if (!readVector(is, g.delta)) { err = "group: expected 16 numbers"; return false; }
      if (Problem::Group* existing = groupOf(g.crBuff)) existing->delta = g.delta;
      else p.groups.push_back(g);
    } else if (kind == "amp") {
      std::string which;
      if (!take(is, which)) { err = "amp: expected never|crit|group"; return false; }
      Problem::Amp a{};
      if (which == "never" || which == "crit") {
        if (!take(is, a.emBuff)) { err = "amp: expected an EM buff"; return false; }
        if (!readVector(is, a.coeffs)) { err = "amp: expected 16 numbers"; return false; }
        (which == "never" ? p.ampNever : p.ampCrit).push_back(a);
      } else if (which == "group") {
        double crBuff = 0;
        if (!take(is, crBuff, a.emBuff)) {
          err = "amp group: expected crit-rate and EM buffs";
          return false;
        }
        if (!readVector(is, a.coeffs)) { err = "amp group: expected 16 numbers"; return false; }
        Problem::Group* g = groupOf(crBuff);
        if (!g) {
          Problem::Group made{};
          made.crBuff = crBuff;
          p.groups.push_back(made);
          g = &p.groups.back();
        }
        g->amp.push_back(a);
      } else {
        err = "amp must be never|crit|group";
        return false;
      }
    } else if (kind == "ref") {
      p.hasRef = true;
      if (!take(is, p.refA, p.refC, p.refR)) {
        err = "ref: expected A, C and R";
        return false;
      }
      if (!(is >> p.refE)) p.refE = 0;
    } else {
      err = "unknown record: " + kind;
      return false;
    }
  }
  return true;
}

/*
 * Fold the 'allow' records into the pieces, once.
 *
 * The records are kept verbatim while reading because a piece may be named by an
 * 'allow' before its own 'piece' line, and because "must" is a property of the
 * pair rather than of the piece.
 */
bool bindAllows(Problem& p, std::string& err) {
  for (const auto& a : p.allows) {
    Problem::Piece* pc = p.pieceOf(a.slot);
    if (!pc) { err = "allow names an unknown piece: " + a.slot; return false; }
    if (std::find(pc->allowed.begin(), pc->allowed.end(), a.stat) == pc->allowed.end()) {
      pc->allowed.push_back(a.stat);
    }
    if (a.state >= 2
        && std::find(pc->required.begin(), pc->required.end(), a.stat) == pc->required.end()) {
      pc->required.push_back(a.stat);
    }
  }
  for (const auto& pc : p.pieces) {
    if (pc.lines < 1) { err = "piece " + pc.slot + ": needs at least one line"; return false; }
    if ((int)pc.allowed.size() < pc.lines) {
      err = "piece " + pc.slot + ": only " + std::to_string(pc.allowed.size())
          + " substats are allowed but it carries " + std::to_string(pc.lines) + " lines";
      return false;
    }
    if (pc.rolls < pc.lines) {
      err = "piece " + pc.slot + ": " + std::to_string(pc.rolls)
          + " rolls cannot give every one of " + std::to_string(pc.lines)
          + " lines its first roll";
      return false;
    }
    if (pc.rolls > pc.lines * pc.maxPerLine) {
      err = "piece " + pc.slot + ": " + std::to_string(pc.rolls)
          + " rolls do not fit in " + std::to_string(pc.lines) + " lines at most "
          + std::to_string(pc.maxPerLine) + " each";
      return false;
    }
    if ((int)pc.required.size() > pc.lines) {
      err = "piece " + pc.slot + ": more required substats than lines";
      return false;
    }
  }
  if (p.pieces.empty()) { err = "no pieces"; return false; }
  return true;
}

// Rolls per declared substat.
using Rolls = std::array<int, MAX_STATS>;

/*
 * One way a single piece could end up: the roll count on every substat.
 *
 * 'key' packs only the feeding counts, because that is all the damage can
 * see. Two pieces whose junk rolls differ but whose feeding counts agree are the
 * same candidate as far as the search is concerned, which is what keeps the level
 * sizes bounded.
 */
struct Cand {
  uint64_t key = 0;
  Rolls rolls{};
};

/*
 * Spread 'left' rolls over the chosen lines, low line first.
 *
 * Every line keeps at least one roll, so the slack a line may take is what is left
 * after reserving one for each line still to be filled -- the reason 'lines <= rolls'
 * is checked up front rather than discovered here.
 */
void distribute(const Problem& p, const Problem::Piece& pc, const std::vector<int>& chosen,
                size_t idx, int left, Rolls& rolls, uint64_t key, std::vector<Cand>& out) {
  if (idx == chosen.size()) {
    if (left == 0) out.push_back({key, rolls});
    return;
  }
  const int stillToFill = (int)(chosen.size() - idx) - 1;
  const int hi = std::min(pc.maxPerLine, left - stillToFill);
  for (int v = 1; v <= hi; ++v) {
    const int st = chosen[idx];
    rolls[st] += v;
    uint64_t next = key;
    if (p.feed[st] >= 0) next += (uint64_t)v << (FEED_BITS * p.feed[st]);
    distribute(p, pc, chosen, idx + 1, left - v, rolls, next, out);
    rolls[st] -= v;
  }
}

// Every set of 'lines' distinct substats, each one getting 1..maxPerLine rolls.
void chooseLines(const Problem& p, const Problem::Piece& pc, size_t start,
                 std::vector<int>& chosen, std::vector<Cand>& out) {
  if ((int)chosen.size() == pc.lines) {
    for (int r : pc.required) {
      if (std::find(chosen.begin(), chosen.end(), r) == chosen.end()) return;
    }
    Rolls rolls{};
    distribute(p, pc, chosen, 0, pc.rolls, rolls, 0, out);
    return;
  }
  const int missing = pc.lines - (int)chosen.size();
  for (size_t i = start; i < pc.allowed.size(); ++i) {
    if ((int)(pc.allowed.size() - i) < missing) break;
    chosen.push_back(pc.allowed[i]);
    chooseLines(p, pc, i + 1, chosen, out);
    chosen.pop_back();
  }
}

std::vector<Cand> candidatesOf(const Problem& p, const Problem::Piece& pc) {
  std::vector<Cand> all;
  std::vector<int> chosen;
  chooseLines(p, pc, 0, chosen, all);

  std::vector<Cand> uniq;
  std::unordered_set<uint64_t> seen;
  for (auto& c : all) if (seen.insert(c.key).second) uniq.push_back(std::move(c));
  return uniq;
}

struct Row {
  double A = 0, C = 0, R = 0, E = 0;
  double never = 0, crit = 0, avg = 0;
  Rolls rolls{};
  int total = 0;
};

// A quantised key, so "the same outcome" means the same number and not a nearby
// one. It is a tuple rather than an arithmetic hash: two different outcomes can
// collide under `a * 1000003 + b * 1009 + c`, and a collision here DROPS a row.
struct OutcomeKey {
  long long a = 0, c = 0, r = 0, e = 0;
  bool operator==(const OutcomeKey& o) const {
    return a == o.a && c == o.c && r == o.r && e == o.e;
  }
};

struct OutcomeKeyHash {
  size_t operator()(const OutcomeKey& k) const {
    size_t h = 0;
    const auto mix = [&h](long long x) {
      h ^= std::hash<long long>{}(x) + 0x9e3779b97f4a7c15ULL + (h << 6) + (h >> 2);
    };
    mix(k.a); mix(k.c); mix(k.r); mix(k.e);
    return h;
  }
};

inline OutcomeKey keyOf(double A, double C, double R, double E, bool includeE) {
  const auto q = [](double x) { return (long long)std::llround(x * 1e4); };
  return { q(A), q(C), q(R), includeE ? q(E) : 0 };
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "usage: optimize <problem.txt>\n";
    return 2;
  }

  Problem p;
  std::string err;
  if (!readProblem(argv[1], p, err)) {
    std::cerr << "problem: " << err << "\n";
    return 1;
  }
  if (!bindAllows(p, err)) {
    std::cerr << "problem: " << err << "\n";
    return 1;
  }
  if (p.keys.empty()) {
    std::cerr << "problem: no substats declared\n";
    return 1;
  }

  const int n = (int)p.keys.size();
  const bool amp = hasAmp(p);
  // EM is a junk line unless an amplifying reaction makes it matter. Treating it
  // as a search dimension anyway would multiply every level for no benefit.
  if (!amp) {
    for (int i = 0; i < n; ++i) if (p.keys[i] == "em") p.feed[i] = -1;
  }

  // THE COMBINE: one level per piece, deduped on the FEEDING ROLL COUNTS.
  //
  // Dedupe is exact rather than heuristic: the final damage reads nothing but the
  // totals, and a future piece only ever adds to them, so a partial state that has
  // been reached once can never be worth expanding a second time under a different
  // set of lines. What the level keeps is the first allocation that reached it,
  // which is what the CSV reports.
  std::unordered_map<uint64_t, Rolls> level;
  level.emplace(0, Rolls{});
  for (const auto& pc : p.pieces) {
    const std::vector<Cand> cands = candidatesOf(p, pc);
    std::unordered_map<uint64_t, Rolls> next;
    next.reserve(level.size() * 2);
    for (const auto& entry : level) {
      for (const Cand& c : cands) {
        const uint64_t key = entry.first + c.key;
        if (next.find(key) != next.end()) continue;
        Rolls rolls = entry.second;
        for (int i = 0; i < n; ++i) rolls[i] += c.rolls[i];
        next.emplace(key, rolls);
      }
    }
    level.swap(next);
    std::fprintf(stderr, "after %s: %zu states\n", pc.slot.c_str(), level.size());
  }

  std::vector<Row> rows;
  std::unordered_set<OutcomeKey, OutcomeKeyHash> seen;
  rows.reserve(level.size());
  for (const auto& entry : level) {
    double atkPct = p.atkPct, flatAtk = p.flatAtk, critRate = p.critRate, critDmg = p.critDmg;
    double em = p.em;
    for (int i = 0; i < n; ++i) {
      const int r = entry.second[i];
      if (!r) continue;
      const double add = r * p.value[i];
      switch (p.feed[i]) {
        case 0: atkPct += add; break;
        case 1: flatAtk += add; break;
        case 2: critRate += add; break;
        case 3: critDmg += add; break;
        case 4: em += add; break;
        default: break;
      }
    }
    const double A = p.atk * (1 + atkPct / 100.0) + flatAtk;
    const double C = critDmg;
    const double R = critRate;
    const double E = em;
    if (!seen.insert(keyOf(A, C, R, E, amp)).second) continue;

    Row row;
    row.A = A; row.C = C; row.R = R; row.E = E;
    row.rolls = entry.second;
    row.total = 0;
    for (int i = 0; i < n; ++i) row.total += entry.second[i];
    row.never = evalCoeffs(p.never, A, p.anemoDmg, p.pyroDmg, p.dmgBonus, C)
              + evalAmp(p.ampNever, E, A, p.anemoDmg, p.pyroDmg, p.dmgBonus, C);
    row.crit = evalCoeffs(p.crit, A, p.anemoDmg, p.pyroDmg, p.dmgBonus, C)
             + evalAmp(p.ampCrit, E, A, p.anemoDmg, p.pyroDmg, p.dmgBonus, C);
    row.avg = row.never;
    for (const auto& g : p.groups) {
      const double mu = std::min(R + g.crBuff, 100.0) / 100.0;
      row.avg += mu * (evalCoeffs(g.delta, A, p.anemoDmg, p.pyroDmg, p.dmgBonus, C)
                     + evalAmp(g.amp, E, A, p.anemoDmg, p.pyroDmg, p.dmgBonus, C));
    }
    rows.push_back(std::move(row));
  }

  std::sort(rows.begin(), rows.end(),
            [](const Row& a, const Row& b) { return a.avg > b.avg; });

  for (int i = 0; i < n; ++i) std::printf("%s,", p.keys[i].c_str());
  std::printf("total,A,C,R,E,dmg_never,dmg_crit,dmg_avg,is_current\n");
  for (const auto& r : rows) {
    for (int i = 0; i < n; ++i) std::printf("%d,", r.rolls[i]);
    std::printf("%d,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,0\n",
                r.total, r.A, r.C, r.R, r.E, r.never, r.crit, r.avg);
  }
  if (p.hasRef) {
    for (int i = 0; i < n; ++i) std::printf(",");
    const double never = evalCoeffs(p.never, p.refA, p.anemoDmg, p.pyroDmg, p.dmgBonus, p.refC)
                       + evalAmp(p.ampNever, p.refE, p.refA, p.anemoDmg, p.pyroDmg, p.dmgBonus, p.refC);
    const double crit = evalCoeffs(p.crit, p.refA, p.anemoDmg, p.pyroDmg, p.dmgBonus, p.refC)
                      + evalAmp(p.ampCrit, p.refE, p.refA, p.anemoDmg, p.pyroDmg, p.dmgBonus, p.refC);
    double avg = never;
    for (const auto& g : p.groups) {
      const double mu = std::min(p.refR + g.crBuff, 100.0) / 100.0;
      avg += mu * (evalCoeffs(g.delta, p.refA, p.anemoDmg, p.pyroDmg, p.dmgBonus, p.refC)
                 + evalAmp(g.amp, p.refE, p.refA, p.anemoDmg, p.pyroDmg, p.dmgBonus, p.refC));
    }
    std::printf(",%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,%.6f,1\n",
                p.refA, p.refC, p.refR, p.refE, never, crit, avg);
  }
  std::fprintf(stderr, "distinct outcomes: %zu\n", rows.size());
  return 0;
}
