import polytechnicLogo from '@/assets/polytechnic-logo.jpg';
import { ExternalLink } from 'lucide-react';

const APP_VERSION = 'EDMS v1.0';

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t bg-card mt-8">
      {/* Institution + developer credit */}
      <div className="max-w-screen-lg mx-auto px-4 py-6 grid gap-6 sm:grid-cols-2 sm:divide-x divide-border">
        <div className="flex items-start gap-3 sm:pr-6">
          <img
            src={polytechnicLogo}
            alt="The Nyamira National Polytechnic crest"
            className="w-12 h-12 object-contain shrink-0 rounded"
          />
          <div className="leading-tight">
            <p className="text-sm font-bold text-primary">The Nyamira National Polytechnic</p>
            <p className="text-xs text-secondary font-semibold uppercase tracking-wide">Home of Innovation</p>
            <a
              href="https://nyamirapoly.ac.ke"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              nyamirapoly.ac.ke <ExternalLink className="w-3 h-3" />
            </a>
            <p className="mt-2 text-xs text-muted-foreground">
              Electronic Document Management System for CBET / TVET CDACC teaching documents.
            </p>
          </div>
        </div>

        <div className="sm:pl-6">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Designed &amp; developed by
          </p>
          <a
            href="https://tonnyomondi.lovable.app"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-primary hover:underline"
          >
            Office of the Systems Administrator <ExternalLink className="w-3.5 h-3.5" />
          </a>
          <p className="text-xs text-muted-foreground mt-1">
            The Nyamira National Polytechnic · ICT &amp; Systems
          </p>
        </div>
      </div>

      {/* Copyright bar */}
      <div className="border-t bg-muted/30">
        <div className="max-w-screen-lg mx-auto px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-1 text-center">
          <p className="text-xs text-muted-foreground">
            &copy; {year} The Nyamira National Polytechnic. All rights reserved.
          </p>
          <p className="text-[11px] text-muted-foreground">{APP_VERSION}</p>
        </div>
      </div>
    </footer>
  );
}
