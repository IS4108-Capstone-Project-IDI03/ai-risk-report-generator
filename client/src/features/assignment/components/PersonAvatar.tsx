// A person's initials in the light-blue circle the sidebar's account row uses (RV-11,
// boards 09, 12, 13). Used by EngineerPicker and the Assessments list's Engineer cell.
import { initials } from '../../clients/components/ClientAvatar'
import '../assignment.css'

export function PersonAvatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <span className="person-avatar" style={{ width: size, height: size }} aria-hidden="true">
      {initials(name)}
    </span>
  )
}
