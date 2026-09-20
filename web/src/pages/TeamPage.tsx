import { Layout } from "../components/Layout";
import { asset } from "../lib/snapshot";

/**
 * Who built this, as a roster strip: four equal columns between two rules,
 * each numbered, portrait square, name, and the two places to find them.
 * Public, like a box: a judge following the link shouldn't have to sign in to
 * see whose work it is.
 *
 * Photos are files in public/team/, not LinkedIn URLs, which are signed and
 * expire. Anyone whose photo is missing falls back to their initials, so the
 * column is never a hole.
 */
const PEOPLE = [
  { name: "Soumil Bhandari", github: "SoumilBhandari", linkedin: "soumil-bhandari-1a069b25a", photo: "soumil.jpg" },
  { name: "TAIDI LAAMIRI Taha", github: "DexterTaha", linkedin: "taha-taidi-laamiri", photo: "taha.jpg" },
  { name: "Ye Yint Phone Pyae", github: "yyppyae", linkedin: "yyppyae", photo: "ye-yint.jpg" },
  { name: "Avery Wu", github: "clemencecoco", linkedin: "chenhua-wu-875933359", photo: "avery.jpg" },
];

/** The first letter of the first and last word: "Soumil Bhandari" reads SB. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function Pill({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="rounded-full px-2.5 py-[5px] text-xs font-medium text-text no-underline transition-colors hover:bg-[var(--accent-tint)]"
      style={{ border: "1px solid var(--accent-tint-strong)" }}
    >
      {children}
    </a>
  );
}

export default function TeamPage() {
  return (
    <Layout>
      <header className="mt-8">
        <p className="eyebrow m-0">HopHacks 2026</p>
        <div className="mt-3.5 flex flex-wrap items-end justify-between gap-6">
          <h1 className="ui-display m-0 text-[44px] leading-none lg:text-[60px]">Team</h1>
          <p className="m-0 pb-1.5 text-[17px] text-neutral-500">Built over the 36 hours, by four people.</p>
        </div>
      </header>

      {/* Pulled out by the cell padding, so column 1's portrait still lines up
          with the title while all four columns stay exactly the same width. */}
      <ul
        className="m-0 mt-10 grid list-none grid-cols-1 p-0 sm:grid-cols-2 lg:-mx-6 lg:grid-cols-4"
        style={{ borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
      >
        {PEOPLE.map((p, i) => (
          <li
            key={p.github}
            className="flex flex-col gap-4 py-7 max-lg:border-b max-lg:last:border-b-0 lg:px-6"
            style={{ borderColor: "var(--border)", borderRight: i < PEOPLE.length - 1 ? "1px solid var(--border)" : undefined }}
          >
            <span className="font-mono text-xs font-medium text-neutral-500">{String(i + 1).padStart(2, "0")}</span>
            <span
              className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-[10px] text-3xl font-bold text-neutral-500"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
            >
              {initials(p.name)}
              {p.photo && (
                <img
                  src={asset(`/team/${p.photo}`)}
                  alt={p.name}
                  loading="lazy"
                  className="absolute inset-0 size-full object-cover"
                  onError={(e) => e.currentTarget.remove()}
                />
              )}
            </span>
            <span className="text-xl font-semibold tracking-[-0.01em]">{p.name}</span>
            <span className="flex flex-wrap gap-2">
              <Pill href={`https://github.com/${p.github}`}>GitHub</Pill>
              <Pill href={`https://www.linkedin.com/in/${p.linkedin}/`}>LinkedIn</Pill>
            </span>
          </li>
        ))}
      </ul>

      <p className="m-0 mt-7 flex items-center gap-3 text-[15px] leading-relaxed text-neutral-500">
        <span aria-hidden="true" className="size-2 shrink-0 rounded-full" style={{ background: "var(--accent)" }} />
        Every commit in this repo was made inside the event window: the first is Friday 22:11, the last Sunday morning. No code was
        carried in.
      </p>
    </Layout>
  );
}
