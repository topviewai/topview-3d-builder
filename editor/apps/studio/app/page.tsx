import { Suspense } from 'react'
import { WorkbenchClient } from './workbench'

export default function Page() {
  return (
    <Suspense>
      <WorkbenchClient />
    </Suspense>
  )
}
