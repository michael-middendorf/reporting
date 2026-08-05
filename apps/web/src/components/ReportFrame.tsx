type Props = {
  src: string
  title: string
}

/** Full-viewport iframe of a preserved static report (exact styling/behavior). */
export function ReportFrame({ src, title }: Props) {
  return (
    <div className="report-frame-wrap">
      <iframe src={src} title={title} />
    </div>
  )
}
