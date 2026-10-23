// A program is a name a routine carries ("PPL"): the routines sharing one are listed together in
// the Plan. It is a label on each routine, not an entity of its own, so it rides along with the
// routine through sync, copy and export and there is nothing to migrate or keep in step.
export const PROGRAM_MAX = 40

/** A program name as stored: trimmed, one line, short; '' for none. */
export const cleanProgram = v => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, PROGRAM_MAX) : '')

export const programOf = r => cleanProgram(r?.program)

/** The routines in groups, keeping the list's order: [{ name, routines }]. A program sits where its
 *  first routine is; the routines with none are one group with name ''. */
export function groupRoutines(routines) {
  const groups = []
  const byName = new Map()
  for (const r of Array.isArray(routines) ? routines : []) {
    const name = programOf(r)
    let g = byName.get(name)
    if (!g) { g = { name, routines: [] }; byName.set(name, g); groups.push(g) }
    g.routines.push(r)
  }
  return groups
}

/** The program names in use, in the order they first appear. */
export const programNames = routines => groupRoutines(routines).map(g => g.name).filter(Boolean)
