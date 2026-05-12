import SchoolForm from '@/components/SchoolForm'

export default function EditSchoolPage({ params }: { params: { id: string } }) {
  return <SchoolForm schoolId={params.id} />
}
