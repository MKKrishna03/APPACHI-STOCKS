import Link from "next/link";

const actions = [
  {
    href: "/quotation",
    title: "Quotation",
    description: "Create a new quotation or view saved ones",
    icon: "◆",
    featured: true,
  },
  {
    href: "/products",
    title: "Product Details",
    description: "Manage products and wastage tiers",
    icon: "✦",
  },
  {
    href: "/scrap",
    title: "Scrap",
    description: "Old gold/silver exchange",
    icon: "⟳",
  },
];

export default function Home() {
  return (
    <div
      className="min-h-[calc(100vh-57px)]"
      style={{
        background:
          "radial-gradient(circle at 15% 0%, rgba(184,134,11,0.14), transparent 45%), radial-gradient(circle at 85% 100%, rgba(124,45,58,0.10), transparent 45%)",
      }}
    >
      <div className="max-w-4xl mx-auto w-full px-4 py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          {actions.map((action) =>
            action.featured ? (
              <Link
                key={action.href}
                href={action.href}
                className="sm:col-span-2 rounded-2xl p-8 flex items-center justify-between gap-6 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl shadow-lg"
                style={{
                  background:
                    "linear-gradient(135deg, var(--primary), #8a680a)",
                }}
              >
                <div>
                  <span className="text-3xl" style={{ color: "#fffaf0" }}>
                    {action.icon}
                  </span>
                  <h2 className="heading text-2xl sm:text-3xl font-bold mt-3 text-white">
                    {action.title}
                  </h2>
                  <p className="text-sm mt-1 text-amber-50/85">
                    {action.description}
                  </p>
                </div>
                <span className="hidden sm:block text-4xl text-white/40">
                  →
                </span>
              </Link>
            ) : (
              <Link
                key={action.href}
                href={action.href}
                className="card p-6 flex flex-col gap-2 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
              >
                <span
                  className="w-10 h-10 rounded-full flex items-center justify-center text-lg mb-1"
                  style={{
                    background:
                      "color-mix(in srgb, var(--accent) 12%, transparent)",
                    color: "var(--accent)",
                  }}
                >
                  {action.icon}
                </span>
                <span className="heading text-lg font-semibold">
                  {action.title}
                </span>
                <span className="text-sm" style={{ color: "var(--muted)" }}>
                  {action.description}
                </span>
              </Link>
            )
          )}
        </div>
      </div>
    </div>
  );
}
