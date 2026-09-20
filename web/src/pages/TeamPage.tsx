import { Layout, PageTitle } from "../components/Layout";
import { asset } from "../lib/snapshot";

/**
 * Who built this. Public, like a box: a judge following a link shouldn't have
 * to sign in to see whose work it is.
 *
 * Photos are files in public/team/, not LinkedIn URLs: those are signed and
 * expire, so hotlinking them would leave four broken images here in a month.
 * Anyone without a photo yet falls back to their initials, so the page is
 * never missing a person.
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

/** The photo if it loads, otherwise initials; a missing file must not show a broken image. */
function Portrait({ name, photo }: { name: string; photo?: string }) {
  return (
    <span
      aria-hidden="true"
      className="relative grid size-14 shrink-0 place-items-center overflow-hidden rounded-full text-[15px] font-bold tracking-[0.01em]"
      style={{ background: "var(--surface-2)", color: "var(--text-muted)" }}
    >
      {initials(name)}
      {photo && (
        <img
          src={asset(`/team/${photo}`)}
          alt=""
          loading="lazy"
          className="absolute inset-0 size-full object-cover"
          onError={(e) => e.currentTarget.remove()}
        />
      )}
    </span>
  );
}

export default function TeamPage() {
  return (
    <Layout>
      <PageTitle top eyebrow="HopHacks 2026" title="Team" sub="Built over the 36 hours, by four people." />

      <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
        {PEOPLE.map((p) => (
          <li key={p.github} className="panel flex items-center gap-4 p-4">
            <Portrait name={p.name} photo={p.photo} />
            <div className="min-w-0 flex-1">
              <p className="m-0 font-semibold text-balance">{p.name}</p>
              <p className="m-0 mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <a href={`https://github.com/${p.github}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  GitHub
                </a>
                <a href={`https://www.linkedin.com/in/${p.linkedin}/`} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                  LinkedIn
                </a>
              </p>
            </div>
          </li>
        ))}
      </ul>

      <p className="ui-caption m-0 mt-8">
        Every commit in this repo was made inside the event window: the first is Friday 22:11, the last Sunday morning. No code was
        carried in.
      </p>
    </Layout>
  );
}
