import { Link } from 'react-router-dom';
import { END_CTA_COPY, END_CTA_HEADING, type NativeSpec } from '../content/site';
import { useMarketingMeta } from '../seo';

/**
 * Renders the eleven honest-copy pages natively (audiences, Moment
 * Intelligence, live-event solutions, contact) with the shared hero /
 * feature-grid / end-CTA composition from the source archive.
 */
export function NativePage({ spec }: { spec: NativeSpec }) {
  useMarketingMeta(spec);
  const { content } = spec;
  return (
    <>
      <section className="shell content-hero">
        <div className="eyebrow">{content.eyebrow}</div>
        <h1>{content.h1}</h1>
        <p>{content.lede}</p>
        <div className="hero-actions">
          <Link className="cta" to="/solutions">
            Explore solutions
          </Link>
          <Link className="outline" to="/how-it-works">
            How TONDE works
          </Link>
        </div>
      </section>
      <section className="shell">
        <h2 className="section-heading">A production approach built around what matters.</h2>
        <div className="feature-grid">
          {content.features.map((feature) => (
            <article className="feature" key={feature.heading}>
              <span>{feature.num}</span>
              <h3>{feature.heading}</h3>
              <p>{feature.text}</p>
            </article>
          ))}
        </div>
      </section>
      <section className="shell end-cta">
        <h2>{END_CTA_HEADING}</h2>
        <p>{END_CTA_COPY}</p>
        <Link className="cta" to="/product">
          Explore TONDE product
        </Link>
      </section>
    </>
  );
}
