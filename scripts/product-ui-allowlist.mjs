/**
 * Explicit, reviewed exceptions to the product UI architecture gate.
 *
 * Do not add a catch-all pattern here. Each entry needs a product owner,
 * surface and reason in docs/ui/product-ui-allowlist.md.
 */

export const productRoots = [
  "app/dashboard",
  "app/admin",
  "app/sign-in",
  "app/sign-up",
  "app/forgot-password",
  "components/hashpix",
];

export const publicRoots = ["app/components", "app/blog", "app/page.tsx"];

export const approvedTypesetRoots = new Map([
  ["app/dashboard/help/page.tsx", "typeset typeset-help max-w-[42em]"],
]);

export const rawControlAllowlist = new Map([
  ["app/dashboard/components/new-project-wizard.tsx", { type: "file", reason: "Native video file selection is the browser upload boundary." }],
  ["app/dashboard/components/clip-editor.tsx", { type: "color", reason: "Native colour inputs are specialist editor controls." }],
]);

export const arbitraryClassAllowlist = new Map([
  ["max-h-[46dvh]", { owner: "source wizard", category: "viewport-bounded source library", reason: "Keeps a long source library inside the active viewport." }],
  ["max-w-[42em]", { owner: "Help Typeset", category: "rich-content measure", reason: "Canonical Typeset reading measure." }],
  ["[&_img]:h-auto", { owner: "auth", category: "logo intrinsic media", reason: "Prevents the public brand image from inheriting a fixed height." }],
  ["[&_img]:w-36", { owner: "auth", category: "logo layout", reason: "Structural logo width, not a control visual override." }],
  ["grid-cols-[auto_minmax(0,1fr)_auto]", { owner: "admin", category: "data-row layout", reason: "Three-column metadata rows preserve truncation and actions." }],
  ["xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,.65fr)]", { owner: "admin", category: "responsive data layout", reason: "Keeps overview metrics and worker status legible." }],
  ["sm:grid-cols-[minmax(0,1fr)_auto]", { owner: "admin", category: "form layout", reason: "Keeps a compact control adjacent to its label." }],
  ["sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]", { owner: "admin", category: "form layout", reason: "Keeps two fields and an action in one responsive row." }],
  ["grid-cols-[2rem_minmax(0,1fr)]", { owner: "admin shell", category: "sidebar identity layout", reason: "Fixed avatar column plus truncating identity." }],
]);

export const primitiveGeometryExceptions = new Map([
  ["app/dashboard/help/page.tsx:Card:h-full", "Guide cards fill their responsive grid track."],
  ["app/dashboard/components/project-workspace.tsx:Card:project-render-banner px-5 py-4", "Project render notice has route-owned placement inside the existing workspace shell."],
  ["app/dashboard/components/project-workspace.tsx:Button:moment-row__content h-auto min-h-0 flex-1 items-start justify-start px-0 py-0 text-left whitespace-normal", "Transcript moment row is a specialised media-selection surface."],
  ["app/dashboard/components/project-workspace.tsx:Card:moment-inspector gap-0 py-0", "Inspector owns zero-gap panel composition."],
  ["app/dashboard/components/project-workspace.tsx:Card:result-clip gap-0 py-0", "Rendered media card keeps media/content seam geometry."],
  ["app/dashboard/components/project-workspace.tsx:Card:transcript-lines gap-0 py-0", "Transcript list uses compact row geometry."],
  ["app/dashboard/components/project-workspace.tsx:Button:h-auto min-h-20 flex-col items-start justify-start whitespace-normal", "Moment choice card is a specialised review surface with variable transcript copy."],
  ["app/dashboard/components/projects-view.tsx:Card:min-h-90 items-center justify-center px-(--card-spacing)", "Project empty state needs a stable content-area height."],
  ["app/dashboard/components/projects-view.tsx:Card:project-storage px-(--card-spacing)", "Storage summary aligns content with the registry Card spacing token."],
  ["app/dashboard/components/clip-editor.tsx:Card:clip-editor__notice px-4 py-3", "Editor status notice is a specialist workspace surface."],
  ["app/dashboard/components/billing-view.tsx:Card:min-h-36", "Package summary aligns the billing decision grid."],
  ["app/dashboard/components/billing-view.tsx:Button:h-auto min-h-36 flex-col items-start justify-start gap-2 whitespace-normal text-left", "Minute package choice is a content-rich selectable plan surface."],
  ["app/dashboard/components/new-project-wizard.tsx:Button:relative h-auto min-h-20 w-full justify-start whitespace-normal px-4 py-3 text-left", "Source method choice keeps its icon, title and explanatory copy aligned."],
  ["app/dashboard/components/new-project-wizard.tsx:Button:h-auto w-full justify-start px-4 py-5 text-left", "Upload source card is a native-file boundary with descriptive media copy."],
  ["app/dashboard/components/new-project-wizard.tsx:Button:h-auto w-full justify-start px-3 py-2 text-left", "Saved source-library row is a compact media-selection surface."],
  ["app/dashboard/components/new-project-wizard.tsx:Card:wizard-source-ready px-(--card-spacing)", "Confirmed source card aligns content with the registry Card spacing token."],
]);

// This is intentionally a checksum, not a broad selector escape hatch. Any
// dashboard geometry edit requires a deliberate allowlist/document review.
export const dashboardGeometrySha256 = "f7dfa592ef63ec40f7a552cb61b503636c27f5d3cb5a4c863d51b8b5a17e4ba9";
