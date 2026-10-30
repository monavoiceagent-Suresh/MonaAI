import { createFileRoute, Link } from "@tanstack/react-router";
import { DemoDialog } from "@/components/DemoDialog";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Mic, Square, PhoneCall, MessageCircle, BookOpen, Target, Database, Split, X, Menu, Plus,
} from "lucide-react";
import { ConversationProvider } from "@elevenlabs/react";
import { toast } from "sonner";
import { useVoiceAgent } from "@/components/VoiceAgent";
import { Toaster } from "@/components/ui/sonner";
import { monaLogoUrl } from "@/lib/branding";
import ucCommerce from "@/assets/uc-commerce.jpg";
import ucFinance from "@/assets/uc-finance.jpg";
import ucEdu from "@/assets/uc-edu.jpg";
import ucRealEstate from "@/assets/uc-realestate.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mona — Voice Agents That Sound Like Your Best Rep" },
      { name: "description", content: "Mona picks up, dials out and follows through — AI voice agents that talk to customers the way your best people do." },
      { property: "og:title", content: "Mona — Voice Agents That Sound Like Your Best Rep" },
      { property: "og:description", content: "AI voice agents that talk to customers the way your best people do." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const soon = () => toast("Coming soon", { description: "This part of Mona isn't live yet." });

/* ---------- small building blocks ---------- */

function Reveal({ children, delay = 0, className = "" }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setOn(true); io.disconnect(); } }, { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-[900ms] ease-[cubic-bezier(.2,.7,.2,1)] ${on ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"} ${className}`}>
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-medium uppercase tracking-[0.25em] text-primary">{children}</p>;
}

function Heading({ eyebrow, a, b, sub, center }: { eyebrow: string; a: string; b: string; sub?: string; center?: boolean }) {
  return (
    <Reveal className={center ? "mx-auto max-w-3xl text-center" : "max-w-3xl"}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight text-foreground sm:text-6xl">
        {a} <span className="font-light italic text-gold">{b}</span>
      </h2>
      {sub && <p className="mt-5 text-lg text-muted-foreground">{sub}</p>}
    </Reveal>
  );
}

function Pill({ children, onClick, variant = "light", icon }: { children: ReactNode; onClick?: () => void; variant?: "light" | "ghost"; icon?: ReactNode }) {
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-all duration-300 hover:-translate-y-0.5 ${variant === "light" ? "bg-secondary text-secondary-foreground shadow-soft hover:bg-primary" : "border border-border text-foreground hover:border-primary hover:text-primary"}`}>
      {icon}{children}
    </button>
  );
}

function Logo() {
  return (
    <a href="#top" className="flex items-center">
      <img src={monaLogoUrl} alt="Mona — AI Voice Agent" width={1920} height={702} className="h-10 w-auto" />
    </a>
  );
}

function VoiceCard({ agent, className = "" }: { agent: ReturnType<typeof useVoiceAgent>; className?: string }) {
  const label = agent.status === "connecting" ? "Connecting…" : agent.active ? (agent.isSpeaking ? "Mona is speaking" : "Listening — your turn") : "Ready when you are";
  return (
    <div className={`relative overflow-hidden rounded-3xl border border-border bg-card/80 p-8 shadow-soft backdrop-blur-xl sm:p-10 ${className}`}>
      <span className={`pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/20 blur-3xl transition-opacity duration-700 ${agent.active ? "opacity-100" : "opacity-40"}`} />
      <div className="relative flex flex-col items-center text-center">
        <p className="text-xs uppercase tracking-[0.25em] text-muted-foreground">Talk to Mona</p>
        <div className="relative mt-8 grid h-40 w-40 place-items-center">
          <span className={`absolute inset-0 rounded-full border border-primary/30 ${agent.active ? "animate-ping" : "animate-breathe"}`} />
          <span className="absolute inset-4 rounded-full border border-primary/20" />
          <button onClick={agent.active ? agent.stop : agent.start} aria-label={agent.active ? "End the call" : "Start talking"}
            className={`relative grid h-24 w-24 place-items-center rounded-full shadow-soft transition-all duration-300 hover:scale-105 ${agent.active ? "bg-destructive text-destructive-foreground" : "bg-orb text-primary-foreground"}`}>
            {agent.active ? <Square className="h-7 w-7 fill-current" /> : <Mic className="h-9 w-9" strokeWidth={1.5} />}
          </button>
        </div>
        <p className="mt-6 text-sm font-medium text-primary">{label}</p>
        <div className="mt-5 flex h-12 w-full items-center justify-center gap-1">
          {Array.from({ length: 36 }).map((_, i) => (
            <span key={i} className="w-1 flex-1 rounded-full bg-primary/70 animate-wave"
              style={{ height: `${(20 + Math.abs(Math.sin(i * 0.7)) * 80).toFixed(2)}%`, animationDelay: `${(i * 0.05).toFixed(2)}s`, animationDuration: agent.isSpeaking ? "0.8s" : "2.4s", opacity: agent.active ? 1 : 0.4 }} />
          ))}
        </div>
        <p className="mt-6 text-sm text-muted-foreground">Tap the mic and ask anything — it answers like your best employee would.</p>
      </div>
    </div>
  );
}

/* ---------- data ---------- */

const nav = [["Platform", "#platform"], ["Use Cases", "#industries"], ["How it Works", "#how"], ["FAQ", "#faq"]] as const;
const duties = [
  [PhoneCall, "Calls new enquiries within seconds", "A form gets filled, the phone rings. Interest is caught while it's still warm."],
  [MessageCircle, "Sends the right message after", "A quick WhatsApp recap with whatever was promised on the call."],
  [BookOpen, "Knows your business inside out", "Prices, policies, timings — answered confidently, without putting anyone on hold."],
  [Target, "Spots who's ready to buy", "Gently learns budget, timing and need, then flags the serious ones."],
  [Database, "Writes the notes for you", "A clean summary and next step lands in your records after every call."],
  [Split, "Passes the baton smoothly", "Ready buyers reach the right person, with the whole story attached."],
] as const;
const industries = [
  [ucCommerce, "Commerce", "Turns abandoned carts into confirmed orders with a friendly nudge."],
  [ucFinance, "Finance", "Polite payment reminders and loan enquiries handled with care."],
  [ucEdu, "Education", "Answers anxious parents at midnight and books campus visits."],
  [ucRealEstate, "Real estate", "Separates browsers from buyers and fills your viewing calendar."],
] as const;
const steps = [
  ["01", "Brief it", "Tell Mona who it is, what it should say and what it must never say."],
  ["02", "Plug it in", "Point it at your phone number, calendar and customer list."],
  ["03", "Let it talk", "Watch calls roll in, read the summaries, fine-tune as you go."],
] as const;
const faqs = [
  ["Will callers know it's AI?", "Most don't notice. It pauses, listens and lets people interrupt, just like a person would."],
  ["Can it handle regional languages?", "All major Indian languages plus English, including mixed speech like Hinglish and Tanglish."],
  ["Do I need a tech team?", "No. If you can describe the job in plain words, you can set Mona up."],
  ["Who can hear our calls?", "Recordings and transcripts are stored securely and only accessible to your team."],
  ["How is it priced?", "You pay for the minutes Mona talks. Tell us your call volume and we'll suggest a plan."],
] as const;

/* ---------- page ---------- */

function Index() {
  return (
    <ConversationProvider>
      <Page />
      <Toaster />
    </ConversationProvider>
  );
}

function Page() {
  const agent = useVoiceAgent();
  const [menu, setMenu] = useState(false);
  const [demo, setDemo] = useState(false);

  return (
    <div id="top" className="min-h-screen bg-background text-foreground">
      {/* header */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
        <div className="mx-auto flex h-20 max-w-[1280px] items-center justify-between px-5">
          <Logo />
          <nav className="hidden items-center gap-8 lg:flex">
            {nav.map(([t, h]) => <a key={t} href={h} className="text-sm text-foreground/80 transition-colors hover:text-primary">{t}</a>)}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            <Pill onClick={agent.talk} icon={<Mic className="h-4 w-4" />}>Talk to Agent</Pill>
            <Link to="/login" className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-3 text-sm font-semibold text-foreground transition-all duration-300 hover:-translate-y-0.5 hover:border-primary hover:text-primary">Log in</Link>
          </div>
          <button className="lg:hidden" aria-label="Menu" onClick={() => setMenu(!menu)}>{menu ? <X /> : <Menu />}</button>
        </div>
        {menu && (
          <div className="border-t border-border px-5 py-4 lg:hidden">
            {nav.map(([t, h]) => <a key={t} href={h} onClick={() => setMenu(false)} className="block py-2 text-foreground/80">{t}</a>)}
            <div className="mt-3"><Pill onClick={() => { setMenu(false); agent.talk(); }} icon={<Mic className="h-4 w-4" />}>Talk to Agent</Pill></div>
          </div>
        )}
      </header>

      {/* hero */}
      <section className="relative flex items-center overflow-hidden pt-20">
        <span className="pointer-events-none absolute -left-40 top-1/4 h-[34rem] w-[34rem] rounded-full bg-primary/10 blur-[120px]" />
        <span className="pointer-events-none absolute -right-32 bottom-0 h-[28rem] w-[28rem] rounded-full bg-primary/[0.07] blur-[120px]" />
        <div className="relative mx-auto grid w-full max-w-[1280px] items-center gap-14 px-5 py-24 lg:grid-cols-[1.15fr_1fr]">
          {/* left — headline */}
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-4 py-1.5 text-xs uppercase tracking-[0.2em] text-muted-foreground backdrop-blur animate-rise">
              <span className="relative flex h-2 w-2"><span className="absolute inset-0 animate-ping rounded-full bg-primary" /><span className="h-2 w-2 rounded-full bg-primary" /></span>
              AI voice agents for business
            </p>
            <h1 className="mt-7 text-4xl font-bold leading-[1.08] tracking-tight animate-rise sm:text-5xl lg:text-6xl">
              <span className="block">Every call answered.</span>
              <span className="mt-1 block font-light italic text-foreground/80">Every lead followed up.</span>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-foreground/70 animate-rise [animation-delay:200ms]">Mona gives your business a voice that never sleeps — it picks up, dials out, and remembers every word.</p>
            <div className="mt-10 flex flex-wrap gap-3 animate-rise [animation-delay:350ms]">
              <Pill onClick={agent.talk} icon={<PhoneCall className="h-4 w-4" />}>Say hello to Mona</Pill>
              <Pill variant="ghost" onClick={() => setDemo(true)}>Book a Demo</Pill>
            </div>
          </div>

          {/* right — live voice agent */}
          <Reveal delay={250}><VoiceCard agent={agent} /></Reveal>
        </div>
      </section>

      {/* what it does */}
      <section id="platform" className="scroll-mt-20 px-5 py-28">
        <div className="mx-auto max-w-[1280px]">
          <Heading eyebrow="A day in the life" a="The teammate who" b="never clocks out." sub="Here's what Mona quietly takes off your team's plate, every single day." />
          <div className="mt-14 grid gap-px overflow-hidden rounded-3xl border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
            {duties.map(([I, t, d], i) => (
              <div key={t} className="group relative bg-background p-8 transition-colors duration-500 hover:bg-card">
                <span className="absolute right-6 top-6 text-sm font-light text-muted-foreground">0{i + 1}</span>
                <I className="h-7 w-7 text-primary transition-transform duration-500 group-hover:-translate-y-1" strokeWidth={1.5} />
                <h3 className="mt-8 text-xl font-semibold">{t}</h3>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{d}</p>
              </div>
            ))}
          </div>
          <Reveal className="mt-6">
            <div className="grid gap-8 rounded-3xl bg-orb p-8 text-primary-foreground sm:p-10 lg:grid-cols-[1.4fr_1fr] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] opacity-70">No sick days · No bad moods · No missed calls</p>
                <h3 className="mt-3 text-3xl font-bold leading-tight">Same great call at 9 AM or 2 AM.</h3>
              </div>
              <div className="grid grid-cols-3 gap-4 text-center">
                {[["1st", "Ring answered"], ["∞", "Patience"], ["365", "Days a year"]].map(([n, l]) => (
                  <div key={l}><p className="text-3xl font-bold">{n}</p><p className="text-xs opacity-75">{l}</p></div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* industries */}
      <section id="industries" className="scroll-mt-20 px-5 pb-28">
        <div className="mx-auto max-w-[1280px]">
          <Heading eyebrow="Where it shines" a="Built for busy" b="phone lines." />
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {industries.map(([img, t, d], i) => (
              <Reveal key={t} delay={i * 100}>
                <div className="group relative aspect-[3/4] overflow-hidden rounded-3xl border border-border">
                  <img src={img} alt={t} loading="lazy" width={768} height={1024} className="absolute inset-0 h-full w-full object-cover grayscale transition-transform duration-700 group-hover:scale-110" />
                  <div className="absolute inset-0 bg-primary/30 mix-blend-color" />
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
                  <div className="absolute inset-x-0 bottom-0 p-6">
                    <h3 className="text-2xl font-semibold">{t}</h3>
                    <p className="mt-2 max-h-0 overflow-hidden text-sm text-foreground/80 opacity-0 transition-all duration-500 group-hover:max-h-24 group-hover:opacity-100">{d}</p>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>


      {/* how it works */}
      <section id="how" className="scroll-mt-20 px-5 py-28">
        <div className="mx-auto max-w-[1280px]">
          <Heading eyebrow="Getting started" a="Three steps." b="Zero headaches." sub="If you can write a message to a new employee, you can set up Mona." />
          <div className="mt-16 grid gap-10 md:grid-cols-3">
            {steps.map(([n, t, d], i) => (
              <Reveal key={n} delay={i * 150}>
                <div className="border-t border-border pt-6">
                  <p className="text-6xl font-light italic text-gold">{n}</p>
                  <h3 className="mt-6 text-2xl font-semibold">{t}</h3>
                  <p className="mt-3 text-muted-foreground">{d}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* faq */}
      <section id="faq" className="scroll-mt-20 px-5 py-28">
        <div className="mx-auto grid max-w-[1280px] gap-12 lg:grid-cols-[1fr_1.4fr]">
          <Heading eyebrow="Good questions" a="Things people" b="usually ask." sub="Didn't find yours? Ask Mona directly — it's one tap away." />
          <div className="divide-y divide-border border-y border-border">
            {faqs.map(([q, a]) => (
              <details key={q} className="group py-6">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-medium">
                  {q}<Plus className="h-5 w-5 shrink-0 text-primary transition-transform duration-300 group-open:rotate-45" />
                </summary>
                <p className="mt-4 text-muted-foreground">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* final cta */}
      <section className="relative overflow-hidden px-5 py-32 text-center">
        <span className="pointer-events-none absolute left-1/2 top-0 h-[26rem] w-[46rem] -translate-x-1/2 rounded-full bg-primary/10 blur-[130px]" />
        <Reveal className="relative mx-auto max-w-3xl">
          <h2 className="text-5xl font-bold leading-[1] tracking-tight sm:text-7xl">Let your phone <span className="font-light italic text-gold">work for you.</span></h2>
          <p className="mx-auto mt-6 max-w-lg text-lg text-foreground/80">One tap, one real conversation. You'll know in a minute.</p>
          {agent.active ? (
            <VoiceCard agent={agent} className="mx-auto mt-12 max-w-md" />
          ) : (
            <div className="mt-10 flex flex-wrap justify-center gap-3">
              <Pill onClick={agent.talk} icon={<Mic className="h-4 w-4" />}>Talk to Mona</Pill>
              <Pill variant="ghost" onClick={() => setDemo(true)}>Book a Demo</Pill>
            </div>
          )}
        </Reveal>
      </section>

      <footer className="border-t border-border px-5 py-12">
        <div className="mx-auto flex max-w-[1280px] flex-col items-center justify-between gap-6 md:flex-row">
          <Logo />
          <nav className="flex flex-wrap justify-center gap-6">
            {nav.map(([t, h]) => <a key={t} href={h} className="text-sm text-muted-foreground hover:text-primary">{t}</a>)}
          </nav>
          <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Mona. All rights reserved.</p>
        </div>
      </footer>

      <DemoDialog open={demo} onClose={() => setDemo(false)} />
    </div>
  );
}
