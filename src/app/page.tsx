import Link from "next/link";
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";

export default async function HomePage() {
  const user = await getCurrentUser();
  if (user) {
    redirect("/learn");
  }

  return (
    <main className="marketing-page">
      <div className="page-wrap">
        <section className="marketing-nav">
          <div className="marketing-brand">
            <span className="marketing-brand-mark">Y</span>
            <div>
              <strong>LessonLift</strong>
              <p className="muted">YouTube study workspace</p>
            </div>
          </div>
          <div className="marketing-nav-actions">
            <Link className="button button-secondary" href="/login">
              Sign in
            </Link>
            <Link className="button button-primary" href="/signup">
              Get started
            </Link>
          </div>
        </section>

        <section className="hero-card marketing-hero">
          <div className="marketing-hero-copy">
            <p className="marketing-kicker">AI-powered YouTube learning</p>
            <h1>
              Turn one video into a full revision kit.
            </h1>
            <p className="muted marketing-lead">
              Paste a YouTube lesson and get polished notes, an interactive quiz, and transcript-grounded follow-up
              answers in one place.
            </p>
            <div className="marketing-cta-row">
              <Link className="button button-primary" href="/signup">
                Create account
              </Link>
              <Link className="button button-secondary" href="/login">
                Sign in
              </Link>
            </div>
            <div className="marketing-stat-row">
              <div className="marketing-stat">
                <strong>Notes</strong>
                <span className="muted">Clean revision sheets with headings and key points</span>
              </div>
              <div className="marketing-stat">
                <strong>Quiz</strong>
                <span className="muted">Interactive MCQs with instant answer feedback</span>
              </div>
              <div className="marketing-stat">
                <strong>Q&amp;A</strong>
                <span className="muted">Ask only from the transcript, not generic AI knowledge</span>
              </div>
            </div>
          </div>

          <div className="marketing-preview panel">
            <div className="marketing-browser-bar">
              <span />
              <span />
              <span />
            </div>
            <div className="marketing-url-chip">https://www.youtube.com/watch?v=lesson-example</div>
            <div className="marketing-preview-grid">
              <section className="marketing-preview-card">
                <p className="sidebar-eyebrow muted">Study pack</p>
                <h3>Filtration &amp; Crystallisation</h3>
                <ul className="marketing-mini-list">
                  <li>Brief overview with key takeaways</li>
                  <li>Topic sections broken into exam-ready chunks</li>
                  <li>Comparison notes for quick revision</li>
                </ul>
              </section>
              <section className="marketing-preview-card">
                <p className="sidebar-eyebrow muted">Interactive quiz</p>
                <h3>Question 4 of 10</h3>
                <div className="marketing-answer-pill">A. Filtration separates an insoluble solid</div>
                <div className="marketing-answer-pill is-active">B. Crystallisation recovers a soluble solid</div>
                <div className="marketing-answer-pill">C. Evaporation creates gases only</div>
              </section>
            </div>
          </div>
        </section>

        <section className="marketing-feature-grid">
          <article className="panel marketing-feature-card">
            <p className="sidebar-eyebrow muted">1. Add the lesson</p>
            <h3>Paste any transcript-ready YouTube URL</h3>
            <p className="muted">
              The app extracts the transcript and turns messy spoken content into something worth studying from.
            </p>
          </article>

          <article className="panel marketing-feature-card">
            <p className="sidebar-eyebrow muted">2. Build the study pack</p>
            <h3>Generate notes, quiz questions, and grounded answers</h3>
            <p className="muted">
              Everything is processed in the cloud, so learners get a clean workspace instead of a raw chatbot.
            </p>
          </article>

          <article className="panel marketing-feature-card">
            <p className="sidebar-eyebrow muted">3. Revise properly</p>
            <h3>Switch between reading, testing, and asking</h3>
            <p className="muted">
              Move through notes, answer one-question-at-a-time quizzes, and ask follow-ups using only the lesson.
            </p>
          </article>
        </section>

        <section className="panel marketing-bottom-banner">
          <div>
            <p className="sidebar-eyebrow muted">Built for proper revision</p>
            <h2>More like a study product, less like a generic chatbot.</h2>
          </div>
          <div className="marketing-nav-actions">
            <Link className="button button-secondary" href="/login">
              Sign in
            </Link>
            <Link className="button button-primary" href="/signup">
              Start learning
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
