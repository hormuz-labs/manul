export const PanelHeader = ({ title, description }: { title: string; description?: string }) => (
  <div className="mb-4">
    <h2 className="text-[15px] font-semibold">{title}</h2>
    {description && <p className="mt-1 text-dim">{description}</p>}
  </div>
)
