import type * as React from 'react'

export type IconProps = Omit<
  React.HTMLAttributes<HTMLSpanElement>,
  'name' | 'size' | 'color' | 'title' | 'style'
> & {
  name?: string
  size?: number
  color?: string
  title?: string
  style?: React.CSSProperties
}
const CDN = 'https://unpkg.com/lucide-static@0.451.0/icons/'
function Icon({ name, size = 16, color = 'currentColor', title, style = {}, ...rest }: IconProps) {
  const url = 'url(' + CDN + name + '.svg)'
  return (
    <span
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      style={{
        display: 'inline-block',
        width: size,
        height: size,
        flex: '0 0 auto',
        backgroundColor: color,
        WebkitMaskImage: url,
        maskImage: url,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        ...style,
      }}
      {...rest}
    />
  )
}
export { Icon }
