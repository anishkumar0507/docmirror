/* ──────────────────────────────────────────────────────────────────────────
   The Doc Mirror — Master Medical Specialty Database
   350 specialties / subspecialties across 65 categories.

   Single source of truth, shared by the browser (specialty combobox) AND the
   Node backend (doctor verification + competitor search).

   To ADD specialties later: just append objects to SPECIALTIES below — no
   component code changes needed. Each entry:
     { id, name, category, keywords:[...], parentSpecialty }
   ────────────────────────────────────────────────────────────────────────── */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') { window.MEDICAL_SPECIALTIES = api; window.MEDICAL_SPECIALTY_LIST = api.SPECIALTIES; }
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var SPECIALTIES = [
  {
    "id": "family-medicine-physician",
    "name": "Family Medicine Physician",
    "category": "Primary Care",
    "keywords": [
      "family doctor",
      "family physician",
      "family",
      "general",
      "gp",
      "primary care",
      "checkup",
      "fever",
      "cough",
      "cold",
      "physician",
      "clinic"
    ],
    "parentSpecialty": "Family Medicine Physician"
  },
  {
    "id": "general-practitioner",
    "name": "General Practitioner",
    "category": "Primary Care",
    "keywords": [
      "gp",
      "general doctor",
      "family",
      "general",
      "primary care",
      "checkup",
      "fever",
      "cough",
      "cold",
      "physician",
      "clinic"
    ],
    "parentSpecialty": "General Practitioner"
  },
  {
    "id": "general-physician",
    "name": "General Physician",
    "category": "Primary Care",
    "keywords": [
      "general medicine",
      "family",
      "general",
      "gp",
      "primary care",
      "checkup",
      "fever",
      "cough",
      "cold",
      "physician",
      "clinic"
    ],
    "parentSpecialty": "General Physician"
  },
  {
    "id": "primary-care-physician",
    "name": "Primary Care Physician",
    "category": "Primary Care",
    "keywords": [
      "pcp",
      "family",
      "general",
      "gp",
      "primary care",
      "checkup",
      "fever",
      "cough",
      "cold",
      "physician",
      "clinic"
    ],
    "parentSpecialty": "Primary Care Physician"
  },
  {
    "id": "internist",
    "name": "Internist",
    "category": "Internal Medicine",
    "keywords": [
      "internal medicine",
      "internist",
      "general medicine",
      "physician",
      "adult"
    ],
    "parentSpecialty": "Internist"
  },
  {
    "id": "internal-medicine-specialist",
    "name": "Internal Medicine Specialist",
    "category": "Internal Medicine",
    "keywords": [
      "internal medicine",
      "internist",
      "general medicine",
      "physician",
      "adult"
    ],
    "parentSpecialty": "Internal Medicine Specialist"
  },
  {
    "id": "hospitalist",
    "name": "Hospitalist",
    "category": "Internal Medicine",
    "keywords": [
      "inpatient",
      "hospital medicine",
      "internal medicine",
      "internist",
      "general medicine",
      "physician",
      "adult"
    ],
    "parentSpecialty": "Hospitalist"
  },
  {
    "id": "consultant-physician",
    "name": "Consultant Physician",
    "category": "Internal Medicine",
    "keywords": [
      "internal medicine",
      "internist",
      "general medicine",
      "physician",
      "adult"
    ],
    "parentSpecialty": "Consultant Physician"
  },
  {
    "id": "pediatrician",
    "name": "Pediatrician",
    "category": "Pediatrics",
    "keywords": [
      "child specialist",
      "child",
      "children",
      "kids",
      "baby",
      "infant",
      "pediatric",
      "paediatric",
      "newborn"
    ],
    "parentSpecialty": "Pediatrician"
  },
  {
    "id": "neonatologist",
    "name": "Neonatologist",
    "category": "Pediatrics",
    "keywords": [
      "newborn",
      "nicu",
      "premature",
      "preterm",
      "child",
      "children",
      "kids",
      "baby",
      "infant",
      "pediatric",
      "paediatric"
    ],
    "parentSpecialty": "Pediatrician"
  },
  {
    "id": "developmental-pediatrician",
    "name": "Developmental Pediatrician",
    "category": "Pediatrics",
    "keywords": [
      "development",
      "autism",
      "milestones",
      "child",
      "children",
      "kids",
      "baby",
      "infant",
      "pediatric",
      "paediatric",
      "newborn"
    ],
    "parentSpecialty": "Pediatrician"
  },
  {
    "id": "pediatric-surgeon",
    "name": "Pediatric Surgeon",
    "category": "Pediatrics",
    "keywords": [
      "child surgery",
      "congenital",
      "child",
      "children",
      "kids",
      "baby",
      "infant",
      "pediatric",
      "paediatric",
      "newborn"
    ],
    "parentSpecialty": "Pediatrician"
  },
  {
    "id": "pediatric-intensivist",
    "name": "Pediatric Intensivist",
    "category": "Pediatrics",
    "keywords": [
      "picu",
      "critical",
      "child",
      "children",
      "kids",
      "baby",
      "infant",
      "pediatric",
      "paediatric",
      "newborn"
    ],
    "parentSpecialty": "Pediatrician"
  },
  {
    "id": "adolescent-medicine-specialist",
    "name": "Adolescent Medicine Specialist",
    "category": "Pediatrics",
    "keywords": [
      "teenager",
      "adolescent",
      "child",
      "children",
      "kids",
      "baby",
      "infant",
      "pediatric",
      "paediatric",
      "newborn"
    ],
    "parentSpecialty": "Pediatrician"
  },
  {
    "id": "child-psychologist",
    "name": "Child Psychologist",
    "category": "Pediatrics",
    "keywords": [
      "mental health",
      "behaviour",
      "behavior",
      "counseling",
      "child",
      "children",
      "kids",
      "baby",
      "infant",
      "pediatric",
      "paediatric",
      "newborn"
    ],
    "parentSpecialty": "Pediatrician"
  },
  {
    "id": "child-psychiatrist",
    "name": "Child Psychiatrist",
    "category": "Pediatrics",
    "keywords": [
      "mental health",
      "adhd",
      "behaviour",
      "child",
      "children",
      "kids",
      "baby",
      "infant",
      "pediatric",
      "paediatric",
      "newborn"
    ],
    "parentSpecialty": "Pediatrician"
  },
  {
    "id": "cardiologist",
    "name": "Cardiologist",
    "category": "Cardiology",
    "keywords": [
      "heart specialist",
      "heart doctor",
      "heart",
      "cardiac",
      "cardio",
      "chest pain",
      "bp",
      "blood pressure",
      "palpitation"
    ],
    "parentSpecialty": "Cardiologist"
  },
  {
    "id": "interventional-cardiologist",
    "name": "Interventional Cardiologist",
    "category": "Cardiology",
    "keywords": [
      "angioplasty",
      "stent",
      "angiogram",
      "cath lab",
      "heart",
      "cardiac",
      "cardio",
      "chest pain",
      "bp",
      "blood pressure",
      "palpitation"
    ],
    "parentSpecialty": "Cardiologist"
  },
  {
    "id": "pediatric-cardiologist",
    "name": "Pediatric Cardiologist",
    "category": "Cardiology",
    "keywords": [
      "child",
      "congenital heart",
      "heart",
      "cardiac",
      "cardio",
      "chest pain",
      "bp",
      "blood pressure",
      "palpitation"
    ],
    "parentSpecialty": "Cardiologist"
  },
  {
    "id": "electrophysiologist",
    "name": "Electrophysiologist",
    "category": "Cardiology",
    "keywords": [
      "arrhythmia",
      "pacemaker",
      "ablation",
      "rhythm",
      "heart",
      "cardiac",
      "cardio",
      "chest pain",
      "bp",
      "blood pressure",
      "palpitation"
    ],
    "parentSpecialty": "Cardiologist"
  },
  {
    "id": "heart-failure-specialist",
    "name": "Heart Failure Specialist",
    "category": "Cardiology",
    "keywords": [
      "heart failure",
      "cardiomyopathy",
      "heart",
      "cardiac",
      "cardio",
      "chest pain",
      "bp",
      "blood pressure",
      "palpitation"
    ],
    "parentSpecialty": "Cardiologist"
  },
  {
    "id": "cardiac-rehabilitation-specialist",
    "name": "Cardiac Rehabilitation Specialist",
    "category": "Cardiology",
    "keywords": [
      "rehab",
      "recovery",
      "heart",
      "cardiac",
      "cardio",
      "chest pain",
      "bp",
      "blood pressure",
      "palpitation"
    ],
    "parentSpecialty": "Cardiologist"
  },
  {
    "id": "preventive-cardiologist",
    "name": "Preventive Cardiologist",
    "category": "Cardiology",
    "keywords": [
      "cholesterol",
      "lipid",
      "prevention",
      "heart",
      "cardiac",
      "cardio",
      "chest pain",
      "bp",
      "blood pressure",
      "palpitation"
    ],
    "parentSpecialty": "Cardiologist"
  },
  {
    "id": "non-invasive-cardiologist",
    "name": "Non-Invasive Cardiologist",
    "category": "Cardiology",
    "keywords": [
      "echo",
      "stress test",
      "heart",
      "cardiac",
      "cardio",
      "chest pain",
      "bp",
      "blood pressure",
      "palpitation"
    ],
    "parentSpecialty": "Cardiologist"
  },
  {
    "id": "cardiac-imaging-specialist",
    "name": "Cardiac Imaging Specialist",
    "category": "Cardiology",
    "keywords": [
      "echo",
      "mri heart",
      "cardiac ct",
      "heart",
      "cardiac",
      "cardio",
      "chest pain",
      "bp",
      "blood pressure",
      "palpitation"
    ],
    "parentSpecialty": "Cardiologist"
  },
  {
    "id": "adult-congenital-heart-specialist",
    "name": "Adult Congenital Heart Specialist",
    "category": "Cardiology",
    "keywords": [
      "congenital",
      "hole in heart",
      "heart",
      "cardiac",
      "cardio",
      "chest pain",
      "bp",
      "blood pressure",
      "palpitation"
    ],
    "parentSpecialty": "Cardiologist"
  },
  {
    "id": "lipid-specialist",
    "name": "Lipid Specialist",
    "category": "Cardiology",
    "keywords": [
      "cholesterol",
      "lipid",
      "triglycerides",
      "heart",
      "cardiac",
      "cardio",
      "chest pain",
      "bp",
      "blood pressure",
      "palpitation"
    ],
    "parentSpecialty": "Cardiologist"
  },
  {
    "id": "dermatologist",
    "name": "Dermatologist",
    "category": "Dermatology",
    "keywords": [
      "skin specialist",
      "skin doctor",
      "skin",
      "derma",
      "rash",
      "acne",
      "pimple",
      "hair",
      "nail",
      "cosmetic"
    ],
    "parentSpecialty": "Dermatologist"
  },
  {
    "id": "cosmetic-dermatologist",
    "name": "Cosmetic Dermatologist",
    "category": "Dermatology",
    "keywords": [
      "botox",
      "filler",
      "cosmetic",
      "laser",
      "skin",
      "derma",
      "rash",
      "acne",
      "pimple",
      "hair",
      "nail"
    ],
    "parentSpecialty": "Dermatologist"
  },
  {
    "id": "pediatric-dermatologist",
    "name": "Pediatric Dermatologist",
    "category": "Dermatology",
    "keywords": [
      "child skin",
      "skin",
      "derma",
      "rash",
      "acne",
      "pimple",
      "hair",
      "nail",
      "cosmetic"
    ],
    "parentSpecialty": "Dermatologist"
  },
  {
    "id": "dermatosurgeon",
    "name": "Dermatosurgeon",
    "category": "Dermatology",
    "keywords": [
      "skin surgery",
      "mole removal",
      "skin",
      "derma",
      "rash",
      "acne",
      "pimple",
      "hair",
      "nail",
      "cosmetic"
    ],
    "parentSpecialty": "Dermatologist"
  },
  {
    "id": "trichologist",
    "name": "Trichologist",
    "category": "Dermatology",
    "keywords": [
      "hair",
      "hair loss",
      "baldness",
      "scalp",
      "skin",
      "derma",
      "rash",
      "acne",
      "pimple",
      "nail",
      "cosmetic"
    ],
    "parentSpecialty": "Dermatologist"
  },
  {
    "id": "venereologist",
    "name": "Venereologist",
    "category": "Dermatology",
    "keywords": [
      "std",
      "sti",
      "sexually transmitted",
      "skin",
      "derma",
      "rash",
      "acne",
      "pimple",
      "hair",
      "nail",
      "cosmetic"
    ],
    "parentSpecialty": "Dermatologist"
  },
  {
    "id": "mohs-surgeon",
    "name": "Mohs Surgeon",
    "category": "Dermatology",
    "keywords": [
      "skin cancer",
      "mohs",
      "skin",
      "derma",
      "rash",
      "acne",
      "pimple",
      "hair",
      "nail",
      "cosmetic"
    ],
    "parentSpecialty": "Dermatologist"
  },
  {
    "id": "leprologist",
    "name": "Leprologist",
    "category": "Dermatology",
    "keywords": [
      "leprosy",
      "skin",
      "derma",
      "rash",
      "acne",
      "pimple",
      "hair",
      "nail",
      "cosmetic"
    ],
    "parentSpecialty": "Dermatologist"
  },
  {
    "id": "neurologist",
    "name": "Neurologist",
    "category": "Neurology",
    "keywords": [
      "brain specialist",
      "nerve doctor",
      "neurophysician",
      "brain",
      "nerve",
      "neuro",
      "seizure",
      "stroke",
      "headache",
      "migraine",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "neurophysician",
    "name": "Neurophysician",
    "category": "Neurology",
    "keywords": [
      "brain",
      "nerve",
      "neuro",
      "seizure",
      "stroke",
      "headache",
      "migraine",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "interventional-neurologist",
    "name": "Interventional Neurologist",
    "category": "Neurology",
    "keywords": [
      "stroke",
      "clot",
      "thrombectomy",
      "brain",
      "nerve",
      "neuro",
      "seizure",
      "headache",
      "migraine",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "epileptologist",
    "name": "Epileptologist",
    "category": "Neurology",
    "keywords": [
      "epilepsy",
      "seizure",
      "fits",
      "brain",
      "nerve",
      "neuro",
      "stroke",
      "headache",
      "migraine",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "stroke-specialist",
    "name": "Stroke Specialist",
    "category": "Neurology",
    "keywords": [
      "stroke",
      "paralysis",
      "clot",
      "brain",
      "nerve",
      "neuro",
      "seizure",
      "headache",
      "migraine",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "movement-disorder-specialist",
    "name": "Movement Disorder Specialist",
    "category": "Neurology",
    "keywords": [
      "parkinson",
      "tremor",
      "movement",
      "brain",
      "nerve",
      "neuro",
      "seizure",
      "stroke",
      "headache",
      "migraine",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "headache-specialist",
    "name": "Headache Specialist",
    "category": "Neurology",
    "keywords": [
      "headache",
      "migraine",
      "brain",
      "nerve",
      "neuro",
      "seizure",
      "stroke",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "pediatric-neurologist",
    "name": "Pediatric Neurologist",
    "category": "Neurology",
    "keywords": [
      "child",
      "epilepsy child",
      "brain",
      "nerve",
      "neuro",
      "seizure",
      "stroke",
      "headache",
      "migraine",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "neuropsychiatrist",
    "name": "Neuropsychiatrist",
    "category": "Neurology",
    "keywords": [
      "mental health",
      "brain",
      "behaviour",
      "nerve",
      "neuro",
      "seizure",
      "stroke",
      "headache",
      "migraine",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "neuromuscular-specialist",
    "name": "Neuromuscular Specialist",
    "category": "Neurology",
    "keywords": [
      "muscle",
      "myasthenia",
      "neuropathy",
      "brain",
      "nerve",
      "neuro",
      "seizure",
      "stroke",
      "headache",
      "migraine",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "dementia-specialist",
    "name": "Dementia Specialist",
    "category": "Neurology",
    "keywords": [
      "dementia",
      "alzheimer",
      "memory loss",
      "brain",
      "nerve",
      "neuro",
      "seizure",
      "stroke",
      "headache",
      "migraine",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "multiple-sclerosis-specialist",
    "name": "Multiple Sclerosis Specialist",
    "category": "Neurology",
    "keywords": [
      "multiple sclerosis",
      "ms",
      "demyelination",
      "brain",
      "nerve",
      "neuro",
      "seizure",
      "stroke",
      "headache",
      "migraine",
      "memory"
    ],
    "parentSpecialty": "Neurologist"
  },
  {
    "id": "neurosurgeon",
    "name": "Neurosurgeon",
    "category": "Neurosurgery",
    "keywords": [
      "brain surgeon",
      "brain surgery",
      "neuro surgery",
      "spine",
      "tumor",
      "nerve"
    ],
    "parentSpecialty": "Neurosurgeon"
  },
  {
    "id": "pediatric-neurosurgeon",
    "name": "Pediatric Neurosurgeon",
    "category": "Neurosurgery",
    "keywords": [
      "child brain surgery",
      "brain surgery",
      "neuro surgery",
      "spine",
      "tumor",
      "nerve"
    ],
    "parentSpecialty": "Neurosurgeon"
  },
  {
    "id": "skull-base-surgeon",
    "name": "Skull Base Surgeon",
    "category": "Neurosurgery",
    "keywords": [
      "skull base",
      "tumor",
      "brain surgery",
      "neuro surgery",
      "spine",
      "nerve"
    ],
    "parentSpecialty": "Neurosurgeon"
  },
  {
    "id": "functional-neurosurgeon",
    "name": "Functional Neurosurgeon",
    "category": "Neurosurgery",
    "keywords": [
      "dbs",
      "epilepsy surgery",
      "brain surgery",
      "neuro surgery",
      "spine",
      "tumor",
      "nerve"
    ],
    "parentSpecialty": "Neurosurgeon"
  },
  {
    "id": "spinal-neurosurgeon",
    "name": "Spinal Neurosurgeon",
    "category": "Neurosurgery",
    "keywords": [
      "spine",
      "disc",
      "brain surgery",
      "neuro surgery",
      "tumor",
      "nerve"
    ],
    "parentSpecialty": "Neurosurgeon"
  },
  {
    "id": "vascular-neurosurgeon",
    "name": "Vascular Neurosurgeon",
    "category": "Neurosurgery",
    "keywords": [
      "aneurysm",
      "avm",
      "brain bleed",
      "brain surgery",
      "neuro surgery",
      "spine",
      "tumor",
      "nerve"
    ],
    "parentSpecialty": "Neurosurgeon"
  },
  {
    "id": "endoscopic-neurosurgeon",
    "name": "Endoscopic Neurosurgeon",
    "category": "Neurosurgery",
    "keywords": [
      "endoscopy",
      "keyhole brain",
      "brain surgery",
      "neuro surgery",
      "spine",
      "tumor",
      "nerve"
    ],
    "parentSpecialty": "Neurosurgeon"
  },
  {
    "id": "orthopedic-surgeon",
    "name": "Orthopedic Surgeon",
    "category": "Orthopedics",
    "keywords": [
      "bone specialist",
      "ortho doctor",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "orthopedician",
    "name": "Orthopedician",
    "category": "Orthopedics",
    "keywords": [
      "bone doctor",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedician"
  },
  {
    "id": "joint-replacement-surgeon",
    "name": "Joint Replacement Surgeon",
    "category": "Orthopedics",
    "keywords": [
      "knee replacement",
      "hip replacement",
      "arthroplasty",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "sports-injury-specialist",
    "name": "Sports Injury Specialist",
    "category": "Orthopedics",
    "keywords": [
      "sports",
      "ligament",
      "acl",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "arthroscopy-surgeon",
    "name": "Arthroscopy Surgeon",
    "category": "Orthopedics",
    "keywords": [
      "arthroscopy",
      "keyhole",
      "ligament",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "hand-surgeon",
    "name": "Hand Surgeon",
    "category": "Orthopedics",
    "keywords": [
      "hand",
      "wrist",
      "finger",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "foot-and-ankle-surgeon",
    "name": "Foot and Ankle Surgeon",
    "category": "Orthopedics",
    "keywords": [
      "foot",
      "ankle",
      "heel",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "pediatric-orthopedic-surgeon",
    "name": "Pediatric Orthopedic Surgeon",
    "category": "Orthopedics",
    "keywords": [
      "child bone",
      "club foot",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "shoulder-surgeon",
    "name": "Shoulder Surgeon",
    "category": "Orthopedics",
    "keywords": [
      "shoulder",
      "rotator cuff",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "knee-surgeon",
    "name": "Knee Surgeon",
    "category": "Orthopedics",
    "keywords": [
      "knee",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "hip-surgeon",
    "name": "Hip Surgeon",
    "category": "Orthopedics",
    "keywords": [
      "hip",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "trauma-surgeon",
    "name": "Trauma Surgeon",
    "category": "Orthopedics",
    "keywords": [
      "trauma",
      "accident",
      "fracture",
      "bone",
      "joint",
      "ortho",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "orthopedic-oncologist",
    "name": "Orthopedic Oncologist",
    "category": "Orthopedics",
    "keywords": [
      "bone tumor",
      "bone cancer",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "limb-lengthening-surgeon",
    "name": "Limb Lengthening Surgeon",
    "category": "Orthopedics",
    "keywords": [
      "limb lengthening",
      "ilizarov",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "pediatric-orthopedician",
    "name": "Pediatric Orthopedician",
    "category": "Orthopedics",
    "keywords": [
      "child bone",
      "bone",
      "joint",
      "ortho",
      "fracture",
      "knee",
      "hip",
      "shoulder",
      "sprain"
    ],
    "parentSpecialty": "Orthopedic Surgeon"
  },
  {
    "id": "spine-surgeon",
    "name": "Spine Surgeon",
    "category": "Spine",
    "keywords": [
      "spine surgery",
      "disc",
      "slip disc",
      "spine",
      "back",
      "backbone",
      "neck pain",
      "sciatica"
    ],
    "parentSpecialty": "Spine Surgeon"
  },
  {
    "id": "spine-specialist",
    "name": "Spine Specialist",
    "category": "Spine",
    "keywords": [
      "back pain",
      "spine",
      "back",
      "backbone",
      "disc",
      "slip disc",
      "neck pain",
      "sciatica"
    ],
    "parentSpecialty": "Spine Specialist"
  },
  {
    "id": "orthopedic-spine-surgeon",
    "name": "Orthopedic Spine Surgeon",
    "category": "Spine",
    "keywords": [
      "spine",
      "disc",
      "back",
      "backbone",
      "slip disc",
      "neck pain",
      "sciatica"
    ],
    "parentSpecialty": "Spine Surgeon"
  },
  {
    "id": "neuro-spine-surgeon",
    "name": "Neuro Spine Surgeon",
    "category": "Spine",
    "keywords": [
      "spine",
      "nerve",
      "back",
      "backbone",
      "disc",
      "slip disc",
      "neck pain",
      "sciatica"
    ],
    "parentSpecialty": "Spine Surgeon"
  },
  {
    "id": "minimally-invasive-spine-surgeon",
    "name": "Minimally Invasive Spine Surgeon",
    "category": "Spine",
    "keywords": [
      "keyhole spine",
      "endoscopic spine",
      "spine",
      "back",
      "backbone",
      "disc",
      "slip disc",
      "neck pain",
      "sciatica"
    ],
    "parentSpecialty": "Spine Surgeon"
  },
  {
    "id": "pediatric-spine-surgeon",
    "name": "Pediatric Spine Surgeon",
    "category": "Spine",
    "keywords": [
      "scoliosis child",
      "child spine",
      "spine",
      "back",
      "backbone",
      "disc",
      "slip disc",
      "neck pain",
      "sciatica"
    ],
    "parentSpecialty": "Spine Surgeon"
  },
  {
    "id": "gastroenterologist",
    "name": "Gastroenterologist",
    "category": "Gastroenterology",
    "keywords": [
      "stomach specialist",
      "gut doctor",
      "stomach",
      "gastro",
      "digestion",
      "acidity",
      "gas",
      "intestine",
      "gut",
      "ibs"
    ],
    "parentSpecialty": "Gastroenterologist"
  },
  {
    "id": "pediatric-gastroenterologist",
    "name": "Pediatric Gastroenterologist",
    "category": "Gastroenterology",
    "keywords": [
      "child stomach",
      "stomach",
      "gastro",
      "digestion",
      "acidity",
      "gas",
      "intestine",
      "gut",
      "ibs"
    ],
    "parentSpecialty": "Gastroenterologist"
  },
  {
    "id": "ibd-specialist",
    "name": "IBD Specialist",
    "category": "Gastroenterology",
    "keywords": [
      "crohn",
      "colitis",
      "ibd",
      "stomach",
      "gastro",
      "digestion",
      "acidity",
      "gas",
      "intestine",
      "gut",
      "ibs"
    ],
    "parentSpecialty": "Gastroenterologist"
  },
  {
    "id": "pancreas-specialist",
    "name": "Pancreas Specialist",
    "category": "Gastroenterology",
    "keywords": [
      "pancreas",
      "pancreatitis",
      "stomach",
      "gastro",
      "digestion",
      "acidity",
      "gas",
      "intestine",
      "gut",
      "ibs"
    ],
    "parentSpecialty": "Gastroenterologist"
  },
  {
    "id": "endoscopist",
    "name": "Endoscopist",
    "category": "Gastroenterology",
    "keywords": [
      "endoscopy",
      "colonoscopy",
      "stomach",
      "gastro",
      "digestion",
      "acidity",
      "gas",
      "intestine",
      "gut",
      "ibs"
    ],
    "parentSpecialty": "Gastroenterologist"
  },
  {
    "id": "hepato-gastroenterologist",
    "name": "Hepato-Gastroenterologist",
    "category": "Gastroenterology",
    "keywords": [
      "liver",
      "gut",
      "stomach",
      "gastro",
      "digestion",
      "acidity",
      "gas",
      "intestine",
      "ibs"
    ],
    "parentSpecialty": "Gastroenterologist"
  },
  {
    "id": "therapeutic-endoscopist",
    "name": "Therapeutic Endoscopist",
    "category": "Gastroenterology",
    "keywords": [
      "ercp",
      "endoscopy",
      "stomach",
      "gastro",
      "digestion",
      "acidity",
      "gas",
      "intestine",
      "gut",
      "ibs"
    ],
    "parentSpecialty": "Gastroenterologist"
  },
  {
    "id": "gi-motility-specialist",
    "name": "GI Motility Specialist",
    "category": "Gastroenterology",
    "keywords": [
      "motility",
      "reflux",
      "constipation",
      "stomach",
      "gastro",
      "digestion",
      "acidity",
      "gas",
      "intestine",
      "gut",
      "ibs"
    ],
    "parentSpecialty": "Gastroenterologist"
  },
  {
    "id": "hepatologist",
    "name": "Hepatologist",
    "category": "Hepatology",
    "keywords": [
      "liver specialist",
      "liver doctor",
      "liver",
      "hepatitis",
      "jaundice",
      "cirrhosis",
      "fatty liver"
    ],
    "parentSpecialty": "Hepatologist"
  },
  {
    "id": "liver-specialist",
    "name": "Liver Specialist",
    "category": "Hepatology",
    "keywords": [
      "liver",
      "hepatitis",
      "jaundice",
      "cirrhosis",
      "fatty liver"
    ],
    "parentSpecialty": "Hepatologist"
  },
  {
    "id": "transplant-hepatologist",
    "name": "Transplant Hepatologist",
    "category": "Hepatology",
    "keywords": [
      "liver transplant",
      "liver",
      "hepatitis",
      "jaundice",
      "cirrhosis",
      "fatty liver"
    ],
    "parentSpecialty": "Hepatologist"
  },
  {
    "id": "pediatric-hepatologist",
    "name": "Pediatric Hepatologist",
    "category": "Hepatology",
    "keywords": [
      "child liver",
      "liver",
      "hepatitis",
      "jaundice",
      "cirrhosis",
      "fatty liver"
    ],
    "parentSpecialty": "Hepatologist"
  },
  {
    "id": "endocrinologist",
    "name": "Endocrinologist",
    "category": "Endocrinology",
    "keywords": [
      "hormone specialist",
      "thyroid",
      "diabetes",
      "hormone",
      "sugar",
      "endocrine",
      "gland"
    ],
    "parentSpecialty": "Endocrinologist"
  },
  {
    "id": "thyroid-specialist",
    "name": "Thyroid Specialist",
    "category": "Endocrinology",
    "keywords": [
      "thyroid",
      "goiter",
      "hormone",
      "diabetes",
      "sugar",
      "endocrine",
      "gland"
    ],
    "parentSpecialty": "Endocrinologist"
  },
  {
    "id": "reproductive-endocrinologist",
    "name": "Reproductive Endocrinologist",
    "category": "Endocrinology",
    "keywords": [
      "fertility",
      "hormone",
      "pcos",
      "thyroid",
      "diabetes",
      "sugar",
      "endocrine",
      "gland"
    ],
    "parentSpecialty": "Endocrinologist"
  },
  {
    "id": "pediatric-endocrinologist",
    "name": "Pediatric Endocrinologist",
    "category": "Endocrinology",
    "keywords": [
      "child hormone",
      "growth",
      "hormone",
      "thyroid",
      "diabetes",
      "sugar",
      "endocrine",
      "gland"
    ],
    "parentSpecialty": "Endocrinologist"
  },
  {
    "id": "adrenal-specialist",
    "name": "Adrenal Specialist",
    "category": "Endocrinology",
    "keywords": [
      "adrenal",
      "cortisol",
      "hormone",
      "thyroid",
      "diabetes",
      "sugar",
      "endocrine",
      "gland"
    ],
    "parentSpecialty": "Endocrinologist"
  },
  {
    "id": "pituitary-specialist",
    "name": "Pituitary Specialist",
    "category": "Endocrinology",
    "keywords": [
      "pituitary",
      "growth hormone",
      "hormone",
      "thyroid",
      "diabetes",
      "sugar",
      "endocrine",
      "gland"
    ],
    "parentSpecialty": "Endocrinologist"
  },
  {
    "id": "bone-and-mineral-specialist",
    "name": "Bone and Mineral Specialist",
    "category": "Endocrinology",
    "keywords": [
      "osteoporosis",
      "calcium",
      "vitamin d",
      "hormone",
      "thyroid",
      "diabetes",
      "sugar",
      "endocrine",
      "gland"
    ],
    "parentSpecialty": "Endocrinologist"
  },
  {
    "id": "diabetologist",
    "name": "Diabetologist",
    "category": "Diabetology",
    "keywords": [
      "diabetes specialist",
      "sugar doctor",
      "diabetes",
      "sugar",
      "blood sugar",
      "insulin"
    ],
    "parentSpecialty": "Diabetologist"
  },
  {
    "id": "obesity-medicine-specialist",
    "name": "Obesity Medicine Specialist",
    "category": "Diabetology",
    "keywords": [
      "obesity",
      "weight",
      "weight loss",
      "diabetes",
      "sugar",
      "blood sugar",
      "insulin"
    ],
    "parentSpecialty": "Diabetologist"
  },
  {
    "id": "diabetic-foot-specialist",
    "name": "Diabetic Foot Specialist",
    "category": "Diabetology",
    "keywords": [
      "diabetic foot",
      "foot ulcer",
      "diabetes",
      "sugar",
      "blood sugar",
      "insulin"
    ],
    "parentSpecialty": "Diabetologist"
  },
  {
    "id": "nephrologist",
    "name": "Nephrologist",
    "category": "Nephrology",
    "keywords": [
      "kidney specialist",
      "kidney doctor",
      "kidney",
      "renal",
      "dialysis",
      "creatinine",
      "urine"
    ],
    "parentSpecialty": "Nephrologist"
  },
  {
    "id": "kidney-specialist",
    "name": "Kidney Specialist",
    "category": "Nephrology",
    "keywords": [
      "kidney",
      "renal",
      "dialysis",
      "creatinine",
      "urine"
    ],
    "parentSpecialty": "Nephrologist"
  },
  {
    "id": "dialysis-specialist",
    "name": "Dialysis Specialist",
    "category": "Nephrology",
    "keywords": [
      "dialysis",
      "kidney",
      "renal",
      "creatinine",
      "urine"
    ],
    "parentSpecialty": "Nephrologist"
  },
  {
    "id": "transplant-nephrologist",
    "name": "Transplant Nephrologist",
    "category": "Nephrology",
    "keywords": [
      "kidney transplant",
      "kidney",
      "renal",
      "dialysis",
      "creatinine",
      "urine"
    ],
    "parentSpecialty": "Nephrologist"
  },
  {
    "id": "pediatric-nephrologist",
    "name": "Pediatric Nephrologist",
    "category": "Nephrology",
    "keywords": [
      "child kidney",
      "kidney",
      "renal",
      "dialysis",
      "creatinine",
      "urine"
    ],
    "parentSpecialty": "Nephrologist"
  },
  {
    "id": "interventional-nephrologist",
    "name": "Interventional Nephrologist",
    "category": "Nephrology",
    "keywords": [
      "fistula",
      "dialysis access",
      "kidney",
      "renal",
      "dialysis",
      "creatinine",
      "urine"
    ],
    "parentSpecialty": "Nephrologist"
  },
  {
    "id": "urologist",
    "name": "Urologist",
    "category": "Urology",
    "keywords": [
      "urology specialist",
      "urine",
      "urinary",
      "prostate",
      "kidney stone",
      "bladder",
      "urology"
    ],
    "parentSpecialty": "Urologist"
  },
  {
    "id": "kidney-stone-specialist",
    "name": "Kidney Stone Specialist",
    "category": "Urology",
    "keywords": [
      "kidney stone",
      "stone",
      "calculus",
      "urine",
      "urinary",
      "prostate",
      "bladder",
      "urology"
    ],
    "parentSpecialty": "Urologist"
  },
  {
    "id": "reconstructive-urologist",
    "name": "Reconstructive Urologist",
    "category": "Urology",
    "keywords": [
      "reconstruction",
      "stricture",
      "urine",
      "urinary",
      "prostate",
      "kidney stone",
      "bladder",
      "urology"
    ],
    "parentSpecialty": "Urologist"
  },
  {
    "id": "pediatric-urologist",
    "name": "Pediatric Urologist",
    "category": "Urology",
    "keywords": [
      "child urology",
      "urine",
      "urinary",
      "prostate",
      "kidney stone",
      "bladder",
      "urology"
    ],
    "parentSpecialty": "Urologist"
  },
  {
    "id": "uro-oncologist",
    "name": "Uro-Oncologist",
    "category": "Urology",
    "keywords": [
      "prostate cancer",
      "bladder cancer",
      "urine",
      "urinary",
      "prostate",
      "kidney stone",
      "bladder",
      "urology"
    ],
    "parentSpecialty": "Urologist"
  },
  {
    "id": "female-urologist",
    "name": "Female Urologist",
    "category": "Urology",
    "keywords": [
      "female urology",
      "urine leak",
      "urine",
      "urinary",
      "prostate",
      "kidney stone",
      "bladder",
      "urology"
    ],
    "parentSpecialty": "Urologist"
  },
  {
    "id": "neuro-urologist",
    "name": "Neuro-Urologist",
    "category": "Urology",
    "keywords": [
      "bladder nerve",
      "neurogenic bladder",
      "urine",
      "urinary",
      "prostate",
      "kidney stone",
      "bladder",
      "urology"
    ],
    "parentSpecialty": "Urologist"
  },
  {
    "id": "endourologist",
    "name": "Endourologist",
    "category": "Urology",
    "keywords": [
      "laser stone",
      "pcnl",
      "urs",
      "urine",
      "urinary",
      "prostate",
      "kidney stone",
      "bladder",
      "urology"
    ],
    "parentSpecialty": "Urologist"
  },
  {
    "id": "pulmonologist",
    "name": "Pulmonologist",
    "category": "Pulmonology",
    "keywords": [
      "lung specialist",
      "chest specialist",
      "lungs",
      "lung",
      "chest",
      "breathing",
      "asthma",
      "cough",
      "copd",
      "respiratory"
    ],
    "parentSpecialty": "Pulmonologist"
  },
  {
    "id": "chest-specialist",
    "name": "Chest Specialist",
    "category": "Pulmonology",
    "keywords": [
      "chest",
      "tb",
      "lungs",
      "lung",
      "breathing",
      "asthma",
      "cough",
      "copd",
      "respiratory"
    ],
    "parentSpecialty": "Pulmonologist"
  },
  {
    "id": "asthma-specialist",
    "name": "Asthma Specialist",
    "category": "Pulmonology",
    "keywords": [
      "asthma",
      "wheezing",
      "lungs",
      "lung",
      "chest",
      "breathing",
      "cough",
      "copd",
      "respiratory"
    ],
    "parentSpecialty": "Pulmonologist"
  },
  {
    "id": "copd-specialist",
    "name": "COPD Specialist",
    "category": "Pulmonology",
    "keywords": [
      "copd",
      "smoking",
      "lungs",
      "lung",
      "chest",
      "breathing",
      "asthma",
      "cough",
      "respiratory"
    ],
    "parentSpecialty": "Pulmonologist"
  },
  {
    "id": "pediatric-pulmonologist",
    "name": "Pediatric Pulmonologist",
    "category": "Pulmonology",
    "keywords": [
      "child lungs",
      "lungs",
      "lung",
      "chest",
      "breathing",
      "asthma",
      "cough",
      "copd",
      "respiratory"
    ],
    "parentSpecialty": "Pulmonologist"
  },
  {
    "id": "interventional-pulmonologist",
    "name": "Interventional Pulmonologist",
    "category": "Pulmonology",
    "keywords": [
      "bronchoscopy",
      "lungs",
      "lung",
      "chest",
      "breathing",
      "asthma",
      "cough",
      "copd",
      "respiratory"
    ],
    "parentSpecialty": "Pulmonologist"
  },
  {
    "id": "tuberculosis-specialist",
    "name": "Tuberculosis Specialist",
    "category": "Pulmonology",
    "keywords": [
      "tb",
      "tuberculosis",
      "lungs",
      "lung",
      "chest",
      "breathing",
      "asthma",
      "cough",
      "copd",
      "respiratory"
    ],
    "parentSpecialty": "Pulmonologist"
  },
  {
    "id": "sleep-pulmonologist",
    "name": "Sleep Pulmonologist",
    "category": "Pulmonology",
    "keywords": [
      "sleep apnea",
      "snoring",
      "lungs",
      "lung",
      "chest",
      "breathing",
      "asthma",
      "cough",
      "copd",
      "respiratory"
    ],
    "parentSpecialty": "Pulmonologist"
  },
  {
    "id": "rheumatologist",
    "name": "Rheumatologist",
    "category": "Rheumatology",
    "keywords": [
      "arthritis specialist",
      "joint pain",
      "arthritis",
      "autoimmune",
      "gout",
      "lupus",
      "rheumatism"
    ],
    "parentSpecialty": "Rheumatologist"
  },
  {
    "id": "pediatric-rheumatologist",
    "name": "Pediatric Rheumatologist",
    "category": "Rheumatology",
    "keywords": [
      "child arthritis",
      "joint pain",
      "arthritis",
      "autoimmune",
      "gout",
      "lupus",
      "rheumatism"
    ],
    "parentSpecialty": "Rheumatologist"
  },
  {
    "id": "lupus-specialist",
    "name": "Lupus Specialist",
    "category": "Rheumatology",
    "keywords": [
      "lupus",
      "sle",
      "autoimmune",
      "joint pain",
      "arthritis",
      "gout",
      "rheumatism"
    ],
    "parentSpecialty": "Rheumatologist"
  },
  {
    "id": "oncologist",
    "name": "Oncologist",
    "category": "Oncology",
    "keywords": [
      "cancer specialist",
      "cancer doctor",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "medical-oncologist",
    "name": "Medical Oncologist",
    "category": "Oncology",
    "keywords": [
      "chemotherapy",
      "cancer medicine",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "surgical-oncologist",
    "name": "Surgical Oncologist",
    "category": "Oncology",
    "keywords": [
      "cancer surgery",
      "tumor removal",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "radiation-oncologist",
    "name": "Radiation Oncologist",
    "category": "Oncology",
    "keywords": [
      "radiation",
      "radiotherapy",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "pediatric-oncologist",
    "name": "Pediatric Oncologist",
    "category": "Oncology",
    "keywords": [
      "child cancer",
      "leukemia child",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "hemato-oncologist",
    "name": "Hemato-Oncologist",
    "category": "Oncology",
    "keywords": [
      "blood cancer",
      "leukemia",
      "lymphoma",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "breast-cancer-specialist",
    "name": "Breast Cancer Specialist",
    "category": "Oncology",
    "keywords": [
      "breast cancer",
      "breast",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "head-and-neck-oncologist",
    "name": "Head and Neck Oncologist",
    "category": "Oncology",
    "keywords": [
      "oral cancer",
      "throat cancer",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "gynecologic-oncologist",
    "name": "Gynecologic Oncologist",
    "category": "Oncology",
    "keywords": [
      "ovarian cancer",
      "cervical cancer",
      "uterus cancer",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "gastrointestinal-oncologist",
    "name": "Gastrointestinal Oncologist",
    "category": "Oncology",
    "keywords": [
      "stomach cancer",
      "colon cancer",
      "gi cancer",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "thoracic-oncologist",
    "name": "Thoracic Oncologist",
    "category": "Oncology",
    "keywords": [
      "lung cancer",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "neuro-oncologist",
    "name": "Neuro Oncologist",
    "category": "Oncology",
    "keywords": [
      "brain tumor",
      "brain cancer",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "genitourinary-oncologist",
    "name": "Genitourinary Oncologist",
    "category": "Oncology",
    "keywords": [
      "prostate cancer",
      "bladder cancer",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "onco-pathologist",
    "name": "Onco-Pathologist",
    "category": "Oncology",
    "keywords": [
      "cancer biopsy",
      "tumor pathology",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "precision-oncologist",
    "name": "Precision Oncologist",
    "category": "Oncology",
    "keywords": [
      "targeted therapy",
      "genomics",
      "cancer",
      "tumor",
      "tumour",
      "oncology",
      "chemotherapy",
      "malignancy"
    ],
    "parentSpecialty": "Oncologist"
  },
  {
    "id": "hematologist",
    "name": "Hematologist",
    "category": "Hematology",
    "keywords": [
      "blood specialist",
      "blood doctor",
      "blood",
      "anemia",
      "clotting",
      "platelet",
      "bone marrow",
      "bleeding"
    ],
    "parentSpecialty": "Hematologist"
  },
  {
    "id": "pediatric-hematologist",
    "name": "Pediatric Hematologist",
    "category": "Hematology",
    "keywords": [
      "child blood",
      "thalassemia",
      "blood",
      "anemia",
      "clotting",
      "platelet",
      "bone marrow",
      "bleeding"
    ],
    "parentSpecialty": "Hematologist"
  },
  {
    "id": "bone-marrow-transplant-specialist",
    "name": "Bone Marrow Transplant Specialist",
    "category": "Hematology",
    "keywords": [
      "bmt",
      "bone marrow transplant",
      "blood",
      "anemia",
      "clotting",
      "platelet",
      "bone marrow",
      "bleeding"
    ],
    "parentSpecialty": "Hematologist"
  },
  {
    "id": "coagulation-specialist",
    "name": "Coagulation Specialist",
    "category": "Hematology",
    "keywords": [
      "clotting",
      "hemophilia",
      "bleeding disorder",
      "blood",
      "anemia",
      "platelet",
      "bone marrow",
      "bleeding"
    ],
    "parentSpecialty": "Hematologist"
  },
  {
    "id": "transfusion-medicine-specialist",
    "name": "Transfusion Medicine Specialist",
    "category": "Hematology",
    "keywords": [
      "blood bank",
      "transfusion",
      "blood",
      "anemia",
      "clotting",
      "platelet",
      "bone marrow",
      "bleeding"
    ],
    "parentSpecialty": "Hematologist"
  },
  {
    "id": "infectious-disease-specialist",
    "name": "Infectious Disease Specialist",
    "category": "Infectious Disease",
    "keywords": [
      "infection specialist",
      "infection",
      "fever",
      "virus",
      "bacteria",
      "hiv",
      "tb",
      "tropical"
    ],
    "parentSpecialty": "Infectious Disease Specialist"
  },
  {
    "id": "hiv-specialist",
    "name": "HIV Specialist",
    "category": "Infectious Disease",
    "keywords": [
      "hiv",
      "aids",
      "infection",
      "fever",
      "virus",
      "bacteria",
      "tb",
      "tropical"
    ],
    "parentSpecialty": "Infectious Disease Specialist"
  },
  {
    "id": "tropical-medicine-specialist",
    "name": "Tropical Medicine Specialist",
    "category": "Infectious Disease",
    "keywords": [
      "malaria",
      "dengue",
      "tropical",
      "infection",
      "fever",
      "virus",
      "bacteria",
      "hiv",
      "tb"
    ],
    "parentSpecialty": "Infectious Disease Specialist"
  },
  {
    "id": "travel-medicine-specialist",
    "name": "Travel Medicine Specialist",
    "category": "Infectious Disease",
    "keywords": [
      "travel vaccine",
      "travel",
      "infection",
      "fever",
      "virus",
      "bacteria",
      "hiv",
      "tb",
      "tropical"
    ],
    "parentSpecialty": "Infectious Disease Specialist"
  },
  {
    "id": "allergist",
    "name": "Allergist",
    "category": "Immunology & Allergy",
    "keywords": [
      "allergy specialist",
      "allergy",
      "immune",
      "asthma",
      "autoimmune",
      "hay fever",
      "rash"
    ],
    "parentSpecialty": "Allergist"
  },
  {
    "id": "clinical-immunologist",
    "name": "Clinical Immunologist",
    "category": "Immunology & Allergy",
    "keywords": [
      "immune",
      "autoimmune",
      "immunology",
      "allergy",
      "asthma",
      "hay fever",
      "rash"
    ],
    "parentSpecialty": "Clinical Immunologist"
  },
  {
    "id": "pediatric-allergist",
    "name": "Pediatric Allergist",
    "category": "Immunology & Allergy",
    "keywords": [
      "child allergy",
      "allergy",
      "immune",
      "asthma",
      "autoimmune",
      "hay fever",
      "rash"
    ],
    "parentSpecialty": "Allergist"
  },
  {
    "id": "immunodeficiency-specialist",
    "name": "Immunodeficiency Specialist",
    "category": "Immunology & Allergy",
    "keywords": [
      "immune deficiency",
      "recurrent infection",
      "allergy",
      "immune",
      "asthma",
      "autoimmune",
      "hay fever",
      "rash"
    ],
    "parentSpecialty": "Clinical Immunologist"
  },
  {
    "id": "ent-specialist",
    "name": "ENT Specialist",
    "category": "ENT",
    "keywords": [
      "ear nose throat",
      "otolaryngologist",
      "ear",
      "nose",
      "throat",
      "ent",
      "sinus",
      "tonsil",
      "hearing",
      "vertigo"
    ],
    "parentSpecialty": "ENT Specialist"
  },
  {
    "id": "otologist",
    "name": "Otologist",
    "category": "ENT",
    "keywords": [
      "ear",
      "hearing",
      "ear drum",
      "nose",
      "throat",
      "ent",
      "sinus",
      "tonsil",
      "vertigo"
    ],
    "parentSpecialty": "ENT Specialist"
  },
  {
    "id": "neurotologist",
    "name": "Neurotologist",
    "category": "ENT",
    "keywords": [
      "ear",
      "vertigo",
      "balance",
      "nose",
      "throat",
      "ent",
      "sinus",
      "tonsil",
      "hearing"
    ],
    "parentSpecialty": "ENT Specialist"
  },
  {
    "id": "rhinologist",
    "name": "Rhinologist",
    "category": "ENT",
    "keywords": [
      "nose",
      "sinus",
      "sinusitis",
      "ear",
      "throat",
      "ent",
      "tonsil",
      "hearing",
      "vertigo"
    ],
    "parentSpecialty": "ENT Specialist"
  },
  {
    "id": "laryngologist",
    "name": "Laryngologist",
    "category": "ENT",
    "keywords": [
      "throat",
      "voice",
      "larynx",
      "ear",
      "nose",
      "ent",
      "sinus",
      "tonsil",
      "hearing",
      "vertigo"
    ],
    "parentSpecialty": "ENT Specialist"
  },
  {
    "id": "audiologist",
    "name": "Audiologist",
    "category": "ENT",
    "keywords": [
      "hearing",
      "hearing aid",
      "deaf",
      "ear",
      "nose",
      "throat",
      "ent",
      "sinus",
      "tonsil",
      "vertigo"
    ],
    "parentSpecialty": "ENT Specialist"
  },
  {
    "id": "head-and-neck-surgeon",
    "name": "Head and Neck Surgeon",
    "category": "ENT",
    "keywords": [
      "head and neck",
      "neck surgery",
      "throat cancer",
      "ear",
      "nose",
      "throat",
      "ent",
      "sinus",
      "tonsil",
      "hearing",
      "vertigo"
    ],
    "parentSpecialty": "ENT Specialist"
  },
  {
    "id": "pediatric-ent-specialist",
    "name": "Pediatric ENT Specialist",
    "category": "ENT",
    "keywords": [
      "child ear",
      "child tonsil",
      "ear",
      "nose",
      "throat",
      "ent",
      "sinus",
      "tonsil",
      "hearing",
      "vertigo"
    ],
    "parentSpecialty": "ENT Specialist"
  },
  {
    "id": "cochlear-implant-surgeon",
    "name": "Cochlear Implant Surgeon",
    "category": "ENT",
    "keywords": [
      "cochlear implant",
      "deaf",
      "hearing",
      "ear",
      "nose",
      "throat",
      "ent",
      "sinus",
      "tonsil",
      "vertigo"
    ],
    "parentSpecialty": "ENT Specialist"
  },
  {
    "id": "voice-specialist",
    "name": "Voice Specialist",
    "category": "ENT",
    "keywords": [
      "voice",
      "hoarseness",
      "singer",
      "ear",
      "nose",
      "throat",
      "ent",
      "sinus",
      "tonsil",
      "hearing",
      "vertigo"
    ],
    "parentSpecialty": "Laryngologist"
  },
  {
    "id": "sleep-apnea-surgeon",
    "name": "Sleep Apnea Surgeon",
    "category": "ENT",
    "keywords": [
      "snoring",
      "sleep apnea",
      "ear",
      "nose",
      "throat",
      "ent",
      "sinus",
      "tonsil",
      "hearing",
      "vertigo"
    ],
    "parentSpecialty": "ENT Specialist"
  },
  {
    "id": "ophthalmologist",
    "name": "Ophthalmologist",
    "category": "Ophthalmology",
    "keywords": [
      "eye specialist",
      "eye doctor",
      "eye surgeon",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "retina-specialist",
    "name": "Retina Specialist",
    "category": "Ophthalmology",
    "keywords": [
      "retina",
      "diabetic eye",
      "macula",
      "eye",
      "eyes",
      "vision",
      "sight",
      "cataract",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "cornea-specialist",
    "name": "Cornea Specialist",
    "category": "Ophthalmology",
    "keywords": [
      "cornea",
      "corneal transplant",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "cataract-surgeon",
    "name": "Cataract Surgeon",
    "category": "Ophthalmology",
    "keywords": [
      "cataract",
      "lens",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "glaucoma-specialist",
    "name": "Glaucoma Specialist",
    "category": "Ophthalmology",
    "keywords": [
      "glaucoma",
      "eye pressure",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "lasik-surgeon",
    "name": "Lasik Surgeon",
    "category": "Ophthalmology",
    "keywords": [
      "lasik",
      "laser eye",
      "spectacle removal",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "pediatric-ophthalmologist",
    "name": "Pediatric Ophthalmologist",
    "category": "Ophthalmology",
    "keywords": [
      "child eye",
      "squint child",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "oculoplastic-surgeon",
    "name": "Oculoplastic Surgeon",
    "category": "Ophthalmology",
    "keywords": [
      "eyelid",
      "oculoplasty",
      "tear duct",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "uveitis-specialist",
    "name": "Uveitis Specialist",
    "category": "Ophthalmology",
    "keywords": [
      "uveitis",
      "eye inflammation",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "squint-specialist",
    "name": "Squint Specialist",
    "category": "Ophthalmology",
    "keywords": [
      "squint",
      "strabismus",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "optometrist",
    "name": "Optometrist",
    "category": "Ophthalmology",
    "keywords": [
      "eye test",
      "glasses",
      "spectacles",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "glaucoma"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "neuro-ophthalmologist",
    "name": "Neuro-Ophthalmologist",
    "category": "Ophthalmology",
    "keywords": [
      "optic nerve",
      "vision nerve",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "ocular-oncologist",
    "name": "Ocular Oncologist",
    "category": "Ophthalmology",
    "keywords": [
      "eye tumor",
      "eye cancer",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "contact-lens-specialist",
    "name": "Contact Lens Specialist",
    "category": "Ophthalmology",
    "keywords": [
      "contact lens",
      "keratoconus",
      "eye",
      "eyes",
      "vision",
      "sight",
      "retina",
      "cataract",
      "glaucoma",
      "spectacles"
    ],
    "parentSpecialty": "Ophthalmologist"
  },
  {
    "id": "gynecologist",
    "name": "Gynecologist",
    "category": "Gynecology & Obstetrics",
    "keywords": [
      "women specialist",
      "ladies doctor",
      "women",
      "gynec",
      "gynaec",
      "pregnancy",
      "period",
      "uterus",
      "ovary",
      "obgyn",
      "obstetrics"
    ],
    "parentSpecialty": "Gynecologist"
  },
  {
    "id": "obstetrician",
    "name": "Obstetrician",
    "category": "Gynecology & Obstetrics",
    "keywords": [
      "pregnancy",
      "delivery",
      "childbirth",
      "women",
      "gynec",
      "gynaec",
      "period",
      "uterus",
      "ovary",
      "obgyn",
      "obstetrics"
    ],
    "parentSpecialty": "Obstetrician"
  },
  {
    "id": "ob-gyn",
    "name": "OB/GYN",
    "category": "Gynecology & Obstetrics",
    "keywords": [
      "obgyn",
      "obstetrics gynecology",
      "women",
      "gynec",
      "gynaec",
      "pregnancy",
      "period",
      "uterus",
      "ovary",
      "obstetrics"
    ],
    "parentSpecialty": "OB/GYN"
  },
  {
    "id": "high-risk-pregnancy-specialist",
    "name": "High Risk Pregnancy Specialist",
    "category": "Gynecology & Obstetrics",
    "keywords": [
      "high risk pregnancy",
      "complicated pregnancy",
      "women",
      "gynec",
      "gynaec",
      "pregnancy",
      "period",
      "uterus",
      "ovary",
      "obgyn",
      "obstetrics"
    ],
    "parentSpecialty": "Obstetrician"
  },
  {
    "id": "laparoscopic-gynecologist",
    "name": "Laparoscopic Gynecologist",
    "category": "Gynecology & Obstetrics",
    "keywords": [
      "laparoscopy",
      "keyhole",
      "fibroid",
      "women",
      "gynec",
      "gynaec",
      "pregnancy",
      "period",
      "uterus",
      "ovary",
      "obgyn",
      "obstetrics"
    ],
    "parentSpecialty": "Gynecologist"
  },
  {
    "id": "urogynecologist",
    "name": "Urogynecologist",
    "category": "Gynecology & Obstetrics",
    "keywords": [
      "urine leak",
      "prolapse",
      "incontinence",
      "women",
      "gynec",
      "gynaec",
      "pregnancy",
      "period",
      "uterus",
      "ovary",
      "obgyn",
      "obstetrics"
    ],
    "parentSpecialty": "Gynecologist"
  },
  {
    "id": "menopause-specialist",
    "name": "Menopause Specialist",
    "category": "Gynecology & Obstetrics",
    "keywords": [
      "menopause",
      "hormone",
      "women",
      "gynec",
      "gynaec",
      "pregnancy",
      "period",
      "uterus",
      "ovary",
      "obgyn",
      "obstetrics"
    ],
    "parentSpecialty": "Gynecologist"
  },
  {
    "id": "fetal-medicine-specialist",
    "name": "Fetal Medicine Specialist",
    "category": "Gynecology & Obstetrics",
    "keywords": [
      "fetal",
      "scan",
      "anomaly",
      "women",
      "gynec",
      "gynaec",
      "pregnancy",
      "period",
      "uterus",
      "ovary",
      "obgyn",
      "obstetrics"
    ],
    "parentSpecialty": "Obstetrician"
  },
  {
    "id": "adolescent-gynecologist",
    "name": "Adolescent Gynecologist",
    "category": "Gynecology & Obstetrics",
    "keywords": [
      "teenage",
      "period problem",
      "women",
      "gynec",
      "gynaec",
      "pregnancy",
      "period",
      "uterus",
      "ovary",
      "obgyn",
      "obstetrics"
    ],
    "parentSpecialty": "Gynecologist"
  },
  {
    "id": "gynecologic-endoscopic-surgeon",
    "name": "Gynecologic Endoscopic Surgeon",
    "category": "Gynecology & Obstetrics",
    "keywords": [
      "hysteroscopy",
      "laparoscopy",
      "fibroid",
      "women",
      "gynec",
      "gynaec",
      "pregnancy",
      "period",
      "uterus",
      "ovary",
      "obgyn",
      "obstetrics"
    ],
    "parentSpecialty": "Gynecologist"
  },
  {
    "id": "perinatologist",
    "name": "Perinatologist",
    "category": "Gynecology & Obstetrics",
    "keywords": [
      "high risk",
      "fetal",
      "maternal",
      "women",
      "gynec",
      "gynaec",
      "pregnancy",
      "period",
      "uterus",
      "ovary",
      "obgyn",
      "obstetrics"
    ],
    "parentSpecialty": "Obstetrician"
  },
  {
    "id": "ivf-specialist",
    "name": "IVF Specialist",
    "category": "Fertility & IVF",
    "keywords": [
      "ivf",
      "test tube baby",
      "icsi",
      "fertility",
      "infertility",
      "pregnancy",
      "conceive",
      "test tube",
      "iui"
    ],
    "parentSpecialty": "IVF Specialist"
  },
  {
    "id": "fertility-specialist",
    "name": "Fertility Specialist",
    "category": "Fertility & IVF",
    "keywords": [
      "fertility",
      "infertility",
      "conceive",
      "ivf",
      "pregnancy",
      "test tube",
      "iui"
    ],
    "parentSpecialty": "Fertility Specialist"
  },
  {
    "id": "reproductive-medicine-specialist",
    "name": "Reproductive Medicine Specialist",
    "category": "Fertility & IVF",
    "keywords": [
      "reproductive",
      "iui",
      "embryo",
      "fertility",
      "ivf",
      "infertility",
      "pregnancy",
      "conceive",
      "test tube"
    ],
    "parentSpecialty": "Fertility Specialist"
  },
  {
    "id": "embryologist",
    "name": "Embryologist",
    "category": "Fertility & IVF",
    "keywords": [
      "embryo",
      "lab",
      "ivf lab",
      "fertility",
      "ivf",
      "infertility",
      "pregnancy",
      "conceive",
      "test tube",
      "iui"
    ],
    "parentSpecialty": "Fertility Specialist"
  },
  {
    "id": "surrogacy-specialist",
    "name": "Surrogacy Specialist",
    "category": "Fertility & IVF",
    "keywords": [
      "surrogacy",
      "donor",
      "fertility",
      "ivf",
      "infertility",
      "pregnancy",
      "conceive",
      "test tube",
      "iui"
    ],
    "parentSpecialty": "Fertility Specialist"
  },
  {
    "id": "general-surgeon",
    "name": "General Surgeon",
    "category": "General Surgery",
    "keywords": [
      "surgery",
      "operation",
      "surgeon",
      "hernia",
      "appendix",
      "gallbladder",
      "laparoscopic"
    ],
    "parentSpecialty": "General Surgeon"
  },
  {
    "id": "laparoscopic-surgeon",
    "name": "Laparoscopic Surgeon",
    "category": "General Surgery",
    "keywords": [
      "laparoscopy",
      "keyhole",
      "minimal access",
      "surgery",
      "surgeon",
      "operation",
      "hernia",
      "appendix",
      "gallbladder",
      "laparoscopic"
    ],
    "parentSpecialty": "General Surgeon"
  },
  {
    "id": "upper-gi-surgeon",
    "name": "Upper GI Surgeon",
    "category": "General Surgery",
    "keywords": [
      "stomach surgery",
      "esophagus",
      "gastric",
      "surgery",
      "surgeon",
      "operation",
      "hernia",
      "appendix",
      "gallbladder",
      "laparoscopic"
    ],
    "parentSpecialty": "General Surgeon"
  },
  {
    "id": "hernia-specialist",
    "name": "Hernia Specialist",
    "category": "General Surgery",
    "keywords": [
      "hernia",
      "surgery",
      "surgeon",
      "operation",
      "appendix",
      "gallbladder",
      "laparoscopic"
    ],
    "parentSpecialty": "General Surgeon"
  },
  {
    "id": "endocrine-surgeon",
    "name": "Endocrine Surgeon",
    "category": "General Surgery",
    "keywords": [
      "thyroid surgery",
      "adrenal",
      "surgery",
      "surgeon",
      "operation",
      "hernia",
      "appendix",
      "gallbladder",
      "laparoscopic"
    ],
    "parentSpecialty": "General Surgeon"
  },
  {
    "id": "breast-surgeon",
    "name": "Breast Surgeon",
    "category": "General Surgery",
    "keywords": [
      "breast",
      "breast lump",
      "surgery",
      "surgeon",
      "operation",
      "hernia",
      "appendix",
      "gallbladder",
      "laparoscopic"
    ],
    "parentSpecialty": "General Surgeon"
  },
  {
    "id": "hepatobiliary-surgeon",
    "name": "Hepatobiliary Surgeon",
    "category": "General Surgery",
    "keywords": [
      "liver surgery",
      "gallbladder",
      "biliary",
      "surgery",
      "surgeon",
      "operation",
      "hernia",
      "appendix",
      "laparoscopic"
    ],
    "parentSpecialty": "General Surgeon"
  },
  {
    "id": "trauma-and-acute-care-surgeon",
    "name": "Trauma and Acute Care Surgeon",
    "category": "General Surgery",
    "keywords": [
      "trauma",
      "emergency surgery",
      "surgery",
      "surgeon",
      "operation",
      "hernia",
      "appendix",
      "gallbladder",
      "laparoscopic"
    ],
    "parentSpecialty": "General Surgeon"
  },
  {
    "id": "minimal-access-surgeon",
    "name": "Minimal Access Surgeon",
    "category": "General Surgery",
    "keywords": [
      "laparoscopy",
      "keyhole",
      "surgery",
      "surgeon",
      "operation",
      "hernia",
      "appendix",
      "gallbladder",
      "laparoscopic"
    ],
    "parentSpecialty": "General Surgeon"
  },
  {
    "id": "plastic-surgeon",
    "name": "Plastic Surgeon",
    "category": "Plastic & Cosmetic Surgery",
    "keywords": [
      "plastic surgery",
      "reconstruction",
      "plastic",
      "cosmetic",
      "aesthetic",
      "liposuction",
      "botox",
      "skin"
    ],
    "parentSpecialty": "Plastic Surgeon"
  },
  {
    "id": "cosmetic-surgeon",
    "name": "Cosmetic Surgeon",
    "category": "Plastic & Cosmetic Surgery",
    "keywords": [
      "cosmetic",
      "aesthetic",
      "plastic",
      "liposuction",
      "botox",
      "skin",
      "reconstruction"
    ],
    "parentSpecialty": "Cosmetic Surgeon"
  },
  {
    "id": "aesthetic-surgeon",
    "name": "Aesthetic Surgeon",
    "category": "Plastic & Cosmetic Surgery",
    "keywords": [
      "beauty",
      "facial",
      "plastic",
      "cosmetic",
      "aesthetic",
      "liposuction",
      "botox",
      "skin",
      "reconstruction"
    ],
    "parentSpecialty": "Cosmetic Surgeon"
  },
  {
    "id": "reconstructive-surgeon",
    "name": "Reconstructive Surgeon",
    "category": "Plastic & Cosmetic Surgery",
    "keywords": [
      "reconstruction",
      "burns",
      "flap",
      "plastic",
      "cosmetic",
      "aesthetic",
      "liposuction",
      "botox",
      "skin"
    ],
    "parentSpecialty": "Plastic Surgeon"
  },
  {
    "id": "hair-transplant-surgeon",
    "name": "Hair Transplant Surgeon",
    "category": "Plastic & Cosmetic Surgery",
    "keywords": [
      "hair transplant",
      "hair",
      "baldness",
      "plastic",
      "cosmetic",
      "aesthetic",
      "liposuction",
      "botox",
      "skin",
      "reconstruction"
    ],
    "parentSpecialty": "Plastic Surgeon"
  },
  {
    "id": "craniofacial-surgeon",
    "name": "Craniofacial Surgeon",
    "category": "Plastic & Cosmetic Surgery",
    "keywords": [
      "cleft",
      "face",
      "skull",
      "plastic",
      "cosmetic",
      "aesthetic",
      "liposuction",
      "botox",
      "skin",
      "reconstruction"
    ],
    "parentSpecialty": "Plastic Surgeon"
  },
  {
    "id": "burn-surgeon",
    "name": "Burn Surgeon",
    "category": "Plastic & Cosmetic Surgery",
    "keywords": [
      "burns",
      "skin graft",
      "plastic",
      "cosmetic",
      "aesthetic",
      "liposuction",
      "botox",
      "skin",
      "reconstruction"
    ],
    "parentSpecialty": "Plastic Surgeon"
  },
  {
    "id": "microvascular-surgeon",
    "name": "Microvascular Surgeon",
    "category": "Plastic & Cosmetic Surgery",
    "keywords": [
      "replantation",
      "flap",
      "microsurgery",
      "plastic",
      "cosmetic",
      "aesthetic",
      "liposuction",
      "botox",
      "skin",
      "reconstruction"
    ],
    "parentSpecialty": "Plastic Surgeon"
  },
  {
    "id": "body-contouring-surgeon",
    "name": "Body Contouring Surgeon",
    "category": "Plastic & Cosmetic Surgery",
    "keywords": [
      "tummy tuck",
      "liposuction",
      "contour",
      "plastic",
      "cosmetic",
      "aesthetic",
      "botox",
      "skin",
      "reconstruction"
    ],
    "parentSpecialty": "Cosmetic Surgeon"
  },
  {
    "id": "cardiac-surgeon",
    "name": "Cardiac Surgeon",
    "category": "Cardiac Surgery",
    "keywords": [
      "heart surgeon",
      "bypass",
      "open heart",
      "heart surgery",
      "cardiac surgery",
      "valve",
      "cabg"
    ],
    "parentSpecialty": "Cardiac Surgeon"
  },
  {
    "id": "cardiothoracic-surgeon",
    "name": "Cardiothoracic Surgeon",
    "category": "Cardiac Surgery",
    "keywords": [
      "heart",
      "lung",
      "chest surgery",
      "heart surgery",
      "bypass",
      "cardiac surgery",
      "valve",
      "cabg"
    ],
    "parentSpecialty": "Cardiac Surgeon"
  },
  {
    "id": "pediatric-cardiac-surgeon",
    "name": "Pediatric Cardiac Surgeon",
    "category": "Cardiac Surgery",
    "keywords": [
      "child heart surgery",
      "congenital",
      "heart surgery",
      "bypass",
      "cardiac surgery",
      "valve",
      "cabg"
    ],
    "parentSpecialty": "Cardiac Surgeon"
  },
  {
    "id": "heart-transplant-surgeon",
    "name": "Heart Transplant Surgeon",
    "category": "Cardiac Surgery",
    "keywords": [
      "heart transplant",
      "heart surgery",
      "bypass",
      "cardiac surgery",
      "valve",
      "cabg"
    ],
    "parentSpecialty": "Cardiac Surgeon"
  },
  {
    "id": "minimally-invasive-cardiac-surgeon",
    "name": "Minimally Invasive Cardiac Surgeon",
    "category": "Cardiac Surgery",
    "keywords": [
      "keyhole heart",
      "heart surgery",
      "bypass",
      "cardiac surgery",
      "valve",
      "cabg"
    ],
    "parentSpecialty": "Cardiac Surgeon"
  },
  {
    "id": "vascular-surgeon",
    "name": "Vascular Surgeon",
    "category": "Vascular Surgery",
    "keywords": [
      "vein",
      "artery",
      "varicose",
      "vascular",
      "blood vessel",
      "circulation"
    ],
    "parentSpecialty": "Vascular Surgeon"
  },
  {
    "id": "endovascular-surgeon",
    "name": "Endovascular Surgeon",
    "category": "Vascular Surgery",
    "keywords": [
      "stent",
      "angioplasty",
      "aneurysm",
      "vein",
      "artery",
      "vascular",
      "varicose",
      "blood vessel",
      "circulation"
    ],
    "parentSpecialty": "Vascular Surgeon"
  },
  {
    "id": "phlebologist",
    "name": "Phlebologist",
    "category": "Vascular Surgery",
    "keywords": [
      "varicose veins",
      "spider veins",
      "vein",
      "artery",
      "vascular",
      "varicose",
      "blood vessel",
      "circulation"
    ],
    "parentSpecialty": "Vascular Surgeon"
  },
  {
    "id": "thoracic-surgeon",
    "name": "Thoracic Surgeon",
    "category": "Thoracic Surgery",
    "keywords": [
      "lung surgery",
      "chest surgery",
      "thoracic",
      "esophagus"
    ],
    "parentSpecialty": "Thoracic Surgeon"
  },
  {
    "id": "lung-transplant-surgeon",
    "name": "Lung Transplant Surgeon",
    "category": "Thoracic Surgery",
    "keywords": [
      "lung transplant",
      "lung surgery",
      "chest surgery",
      "thoracic",
      "esophagus"
    ],
    "parentSpecialty": "Thoracic Surgeon"
  },
  {
    "id": "colorectal-surgeon",
    "name": "Colorectal Surgeon",
    "category": "Colorectal Surgery",
    "keywords": [
      "colon",
      "rectum",
      "piles",
      "fissure",
      "fistula",
      "colorectal",
      "anus"
    ],
    "parentSpecialty": "Colorectal Surgeon"
  },
  {
    "id": "proctologist",
    "name": "Proctologist",
    "category": "Colorectal Surgery",
    "keywords": [
      "piles",
      "fissure",
      "fistula",
      "anus",
      "hemorrhoids",
      "colon",
      "rectum",
      "colorectal"
    ],
    "parentSpecialty": "Proctologist"
  },
  {
    "id": "piles-specialist",
    "name": "Piles Specialist",
    "category": "Colorectal Surgery",
    "keywords": [
      "piles",
      "hemorrhoids",
      "bleeding",
      "colon",
      "rectum",
      "fissure",
      "fistula",
      "colorectal",
      "anus"
    ],
    "parentSpecialty": "Proctologist"
  },
  {
    "id": "fistula-specialist",
    "name": "Fistula Specialist",
    "category": "Colorectal Surgery",
    "keywords": [
      "fistula",
      "abscess",
      "colon",
      "rectum",
      "piles",
      "fissure",
      "colorectal",
      "anus"
    ],
    "parentSpecialty": "Proctologist"
  },
  {
    "id": "laser-proctologist",
    "name": "Laser Proctologist",
    "category": "Colorectal Surgery",
    "keywords": [
      "laser piles",
      "laser surgery",
      "colon",
      "rectum",
      "piles",
      "fissure",
      "fistula",
      "colorectal",
      "anus"
    ],
    "parentSpecialty": "Proctologist"
  },
  {
    "id": "bariatric-surgeon",
    "name": "Bariatric Surgeon",
    "category": "Bariatric Surgery",
    "keywords": [
      "weight loss surgery",
      "obesity surgery",
      "gastric sleeve",
      "weight loss",
      "obesity",
      "bariatric",
      "gastric bypass",
      "sleeve"
    ],
    "parentSpecialty": "Bariatric Surgeon"
  },
  {
    "id": "metabolic-surgeon",
    "name": "Metabolic Surgeon",
    "category": "Bariatric Surgery",
    "keywords": [
      "metabolic",
      "diabetes surgery",
      "weight loss",
      "obesity",
      "bariatric",
      "gastric bypass",
      "sleeve"
    ],
    "parentSpecialty": "Bariatric Surgeon"
  },
  {
    "id": "transplant-surgeon",
    "name": "Transplant Surgeon",
    "category": "Transplant Surgery",
    "keywords": [
      "transplant",
      "organ",
      "organ transplant",
      "donor"
    ],
    "parentSpecialty": "Transplant Surgeon"
  },
  {
    "id": "liver-transplant-surgeon",
    "name": "Liver Transplant Surgeon",
    "category": "Transplant Surgery",
    "keywords": [
      "liver transplant",
      "transplant",
      "organ transplant",
      "donor"
    ],
    "parentSpecialty": "Transplant Surgeon"
  },
  {
    "id": "kidney-transplant-surgeon",
    "name": "Kidney Transplant Surgeon",
    "category": "Transplant Surgery",
    "keywords": [
      "kidney transplant",
      "renal transplant",
      "transplant",
      "organ transplant",
      "donor"
    ],
    "parentSpecialty": "Transplant Surgeon"
  },
  {
    "id": "pancreas-transplant-surgeon",
    "name": "Pancreas Transplant Surgeon",
    "category": "Transplant Surgery",
    "keywords": [
      "pancreas transplant",
      "transplant",
      "organ transplant",
      "donor"
    ],
    "parentSpecialty": "Transplant Surgeon"
  },
  {
    "id": "emergency-medicine-specialist",
    "name": "Emergency Medicine Specialist",
    "category": "Emergency Medicine",
    "keywords": [
      "emergency",
      "casualty",
      "er",
      "accident",
      "trauma"
    ],
    "parentSpecialty": "Emergency Medicine Specialist"
  },
  {
    "id": "trauma-specialist",
    "name": "Trauma Specialist",
    "category": "Emergency Medicine",
    "keywords": [
      "trauma",
      "accident",
      "emergency",
      "casualty",
      "er"
    ],
    "parentSpecialty": "Emergency Medicine Specialist"
  },
  {
    "id": "pre-hospital-care-specialist",
    "name": "Pre-Hospital Care Specialist",
    "category": "Emergency Medicine",
    "keywords": [
      "ambulance",
      "first aid",
      "emergency",
      "accident",
      "casualty",
      "trauma",
      "er"
    ],
    "parentSpecialty": "Emergency Medicine Specialist"
  },
  {
    "id": "critical-care-specialist",
    "name": "Critical Care Specialist",
    "category": "Critical Care",
    "keywords": [
      "icu",
      "intensivist",
      "intensive care",
      "critical care",
      "ventilator",
      "life support"
    ],
    "parentSpecialty": "Critical Care Specialist"
  },
  {
    "id": "intensivist",
    "name": "Intensivist",
    "category": "Critical Care",
    "keywords": [
      "icu",
      "ventilator",
      "critical care",
      "intensive care",
      "life support"
    ],
    "parentSpecialty": "Critical Care Specialist"
  },
  {
    "id": "cardiac-critical-care-specialist",
    "name": "Cardiac Critical Care Specialist",
    "category": "Critical Care",
    "keywords": [
      "cardiac icu",
      "ccu",
      "icu",
      "critical care",
      "intensive care",
      "ventilator",
      "life support"
    ],
    "parentSpecialty": "Critical Care Specialist"
  },
  {
    "id": "anesthesiologist",
    "name": "Anesthesiologist",
    "category": "Anesthesiology",
    "keywords": [
      "anesthesia",
      "anaesthetist",
      "sedation",
      "anaesthesia",
      "surgery"
    ],
    "parentSpecialty": "Anesthesiologist"
  },
  {
    "id": "cardiac-anesthesiologist",
    "name": "Cardiac Anesthesiologist",
    "category": "Anesthesiology",
    "keywords": [
      "heart surgery anesthesia",
      "anesthesia",
      "anaesthesia",
      "sedation",
      "surgery"
    ],
    "parentSpecialty": "Anesthesiologist"
  },
  {
    "id": "pediatric-anesthesiologist",
    "name": "Pediatric Anesthesiologist",
    "category": "Anesthesiology",
    "keywords": [
      "child anesthesia",
      "anesthesia",
      "anaesthesia",
      "sedation",
      "surgery"
    ],
    "parentSpecialty": "Anesthesiologist"
  },
  {
    "id": "neuro-anesthesiologist",
    "name": "Neuro Anesthesiologist",
    "category": "Anesthesiology",
    "keywords": [
      "brain surgery anesthesia",
      "anesthesia",
      "anaesthesia",
      "sedation",
      "surgery"
    ],
    "parentSpecialty": "Anesthesiologist"
  },
  {
    "id": "obstetric-anesthesiologist",
    "name": "Obstetric Anesthesiologist",
    "category": "Anesthesiology",
    "keywords": [
      "epidural",
      "labour",
      "anesthesia",
      "anaesthesia",
      "sedation",
      "surgery"
    ],
    "parentSpecialty": "Anesthesiologist"
  },
  {
    "id": "pain-medicine-specialist",
    "name": "Pain Medicine Specialist",
    "category": "Pain Medicine",
    "keywords": [
      "pain",
      "pain management",
      "chronic pain",
      "back pain",
      "nerve pain"
    ],
    "parentSpecialty": "Pain Medicine Specialist"
  },
  {
    "id": "interventional-pain-specialist",
    "name": "Interventional Pain Specialist",
    "category": "Pain Medicine",
    "keywords": [
      "nerve block",
      "injection",
      "pain",
      "chronic pain",
      "back pain",
      "nerve pain",
      "pain management"
    ],
    "parentSpecialty": "Pain Medicine Specialist"
  },
  {
    "id": "cancer-pain-specialist",
    "name": "Cancer Pain Specialist",
    "category": "Pain Medicine",
    "keywords": [
      "cancer pain",
      "palliative pain",
      "pain",
      "chronic pain",
      "back pain",
      "nerve pain",
      "pain management"
    ],
    "parentSpecialty": "Pain Medicine Specialist"
  },
  {
    "id": "spine-pain-specialist",
    "name": "Spine Pain Specialist",
    "category": "Pain Medicine",
    "keywords": [
      "back pain",
      "neck pain",
      "pain",
      "chronic pain",
      "nerve pain",
      "pain management"
    ],
    "parentSpecialty": "Pain Medicine Specialist"
  },
  {
    "id": "radiologist",
    "name": "Radiologist",
    "category": "Radiology",
    "keywords": [
      "scan",
      "imaging",
      "x-ray",
      "mri",
      "ct",
      "ultrasound",
      "sonography"
    ],
    "parentSpecialty": "Radiologist"
  },
  {
    "id": "interventional-radiologist",
    "name": "Interventional Radiologist",
    "category": "Radiology",
    "keywords": [
      "embolization",
      "biopsy",
      "image guided",
      "scan",
      "x-ray",
      "mri",
      "ct",
      "ultrasound",
      "imaging",
      "sonography"
    ],
    "parentSpecialty": "Radiologist"
  },
  {
    "id": "sonologist",
    "name": "Sonologist",
    "category": "Radiology",
    "keywords": [
      "ultrasound",
      "sonography",
      "scan",
      "x-ray",
      "mri",
      "ct",
      "imaging"
    ],
    "parentSpecialty": "Radiologist"
  },
  {
    "id": "neuroradiologist",
    "name": "Neuroradiologist",
    "category": "Radiology",
    "keywords": [
      "brain scan",
      "mri brain",
      "scan",
      "x-ray",
      "mri",
      "ct",
      "ultrasound",
      "imaging",
      "sonography"
    ],
    "parentSpecialty": "Radiologist"
  },
  {
    "id": "musculoskeletal-radiologist",
    "name": "Musculoskeletal Radiologist",
    "category": "Radiology",
    "keywords": [
      "bone scan",
      "joint mri",
      "scan",
      "x-ray",
      "mri",
      "ct",
      "ultrasound",
      "imaging",
      "sonography"
    ],
    "parentSpecialty": "Radiologist"
  },
  {
    "id": "breast-radiologist",
    "name": "Breast Radiologist",
    "category": "Radiology",
    "keywords": [
      "mammogram",
      "breast scan",
      "scan",
      "x-ray",
      "mri",
      "ct",
      "ultrasound",
      "imaging",
      "sonography"
    ],
    "parentSpecialty": "Radiologist"
  },
  {
    "id": "fetal-radiologist",
    "name": "Fetal Radiologist",
    "category": "Radiology",
    "keywords": [
      "fetal scan",
      "anomaly scan",
      "scan",
      "x-ray",
      "mri",
      "ct",
      "ultrasound",
      "imaging",
      "sonography"
    ],
    "parentSpecialty": "Radiologist"
  },
  {
    "id": "pathologist",
    "name": "Pathologist",
    "category": "Pathology",
    "keywords": [
      "lab",
      "biopsy",
      "blood test",
      "pathology",
      "sample"
    ],
    "parentSpecialty": "Pathologist"
  },
  {
    "id": "microbiologist",
    "name": "Microbiologist",
    "category": "Pathology",
    "keywords": [
      "bacteria",
      "culture",
      "infection lab",
      "lab",
      "blood test",
      "biopsy",
      "pathology",
      "sample"
    ],
    "parentSpecialty": "Microbiologist"
  },
  {
    "id": "biochemist",
    "name": "Biochemist",
    "category": "Pathology",
    "keywords": [
      "biochemistry",
      "blood chemistry",
      "lab",
      "blood test",
      "biopsy",
      "pathology",
      "sample"
    ],
    "parentSpecialty": "Biochemist"
  },
  {
    "id": "hematopathologist",
    "name": "Hematopathologist",
    "category": "Pathology",
    "keywords": [
      "blood pathology",
      "lab",
      "blood test",
      "biopsy",
      "pathology",
      "sample"
    ],
    "parentSpecialty": "Pathologist"
  },
  {
    "id": "cytopathologist",
    "name": "Cytopathologist",
    "category": "Pathology",
    "keywords": [
      "cytology",
      "fnac",
      "lab",
      "blood test",
      "biopsy",
      "pathology",
      "sample"
    ],
    "parentSpecialty": "Pathologist"
  },
  {
    "id": "forensic-pathologist",
    "name": "Forensic Pathologist",
    "category": "Pathology",
    "keywords": [
      "autopsy",
      "forensic",
      "lab",
      "blood test",
      "biopsy",
      "pathology",
      "sample"
    ],
    "parentSpecialty": "Pathologist"
  },
  {
    "id": "molecular-pathologist",
    "name": "Molecular Pathologist",
    "category": "Pathology",
    "keywords": [
      "genetic test",
      "molecular",
      "lab",
      "blood test",
      "biopsy",
      "pathology",
      "sample"
    ],
    "parentSpecialty": "Pathologist"
  },
  {
    "id": "nuclear-medicine-specialist",
    "name": "Nuclear Medicine Specialist",
    "category": "Nuclear Medicine",
    "keywords": [
      "pet scan",
      "nuclear",
      "thyroid scan",
      "isotope",
      "radioisotope"
    ],
    "parentSpecialty": "Nuclear Medicine Specialist"
  },
  {
    "id": "pet-imaging-specialist",
    "name": "PET Imaging Specialist",
    "category": "Nuclear Medicine",
    "keywords": [
      "pet ct",
      "cancer scan",
      "pet scan",
      "nuclear",
      "thyroid scan",
      "isotope",
      "radioisotope"
    ],
    "parentSpecialty": "Nuclear Medicine Specialist"
  },
  {
    "id": "psychiatrist",
    "name": "Psychiatrist",
    "category": "Psychiatry",
    "keywords": [
      "mental health",
      "depression",
      "anxiety",
      "psychiatry",
      "stress",
      "bipolar"
    ],
    "parentSpecialty": "Psychiatrist"
  },
  {
    "id": "addiction-psychiatrist",
    "name": "Addiction Psychiatrist",
    "category": "Psychiatry",
    "keywords": [
      "addiction",
      "de-addiction",
      "alcohol",
      "drugs",
      "mental health",
      "depression",
      "anxiety",
      "psychiatry",
      "stress",
      "bipolar"
    ],
    "parentSpecialty": "Psychiatrist"
  },
  {
    "id": "geriatric-psychiatrist",
    "name": "Geriatric Psychiatrist",
    "category": "Psychiatry",
    "keywords": [
      "elderly mental health",
      "dementia",
      "mental health",
      "depression",
      "anxiety",
      "psychiatry",
      "stress",
      "bipolar"
    ],
    "parentSpecialty": "Psychiatrist"
  },
  {
    "id": "forensic-psychiatrist",
    "name": "Forensic Psychiatrist",
    "category": "Psychiatry",
    "keywords": [
      "forensic",
      "legal",
      "mental health",
      "depression",
      "anxiety",
      "psychiatry",
      "stress",
      "bipolar"
    ],
    "parentSpecialty": "Psychiatrist"
  },
  {
    "id": "perinatal-psychiatrist",
    "name": "Perinatal Psychiatrist",
    "category": "Psychiatry",
    "keywords": [
      "postpartum",
      "pregnancy mental health",
      "mental health",
      "depression",
      "anxiety",
      "psychiatry",
      "stress",
      "bipolar"
    ],
    "parentSpecialty": "Psychiatrist"
  },
  {
    "id": "psychologist",
    "name": "Psychologist",
    "category": "Psychology",
    "keywords": [
      "mental health",
      "counseling",
      "therapy",
      "counselling",
      "stress",
      "psychology"
    ],
    "parentSpecialty": "Psychologist"
  },
  {
    "id": "clinical-psychologist",
    "name": "Clinical Psychologist",
    "category": "Psychology",
    "keywords": [
      "clinical",
      "assessment",
      "therapy",
      "mental health",
      "counseling",
      "counselling",
      "stress",
      "psychology"
    ],
    "parentSpecialty": "Psychologist"
  },
  {
    "id": "counselor",
    "name": "Counselor",
    "category": "Psychology",
    "keywords": [
      "counseling",
      "counselling",
      "guidance",
      "mental health",
      "therapy",
      "stress",
      "psychology"
    ],
    "parentSpecialty": "Counselor"
  },
  {
    "id": "sex-therapist",
    "name": "Sex Therapist",
    "category": "Psychology",
    "keywords": [
      "sex therapy",
      "relationship",
      "intimacy",
      "mental health",
      "counseling",
      "counselling",
      "therapy",
      "stress",
      "psychology"
    ],
    "parentSpecialty": "Sex Therapist"
  },
  {
    "id": "neuropsychologist",
    "name": "Neuropsychologist",
    "category": "Psychology",
    "keywords": [
      "brain function",
      "cognitive",
      "mental health",
      "counseling",
      "counselling",
      "therapy",
      "stress",
      "psychology"
    ],
    "parentSpecialty": "Clinical Psychologist"
  },
  {
    "id": "rehabilitation-psychologist",
    "name": "Rehabilitation Psychologist",
    "category": "Psychology",
    "keywords": [
      "rehab",
      "disability",
      "mental health",
      "counseling",
      "counselling",
      "therapy",
      "stress",
      "psychology"
    ],
    "parentSpecialty": "Clinical Psychologist"
  },
  {
    "id": "physiatrist",
    "name": "Physiatrist",
    "category": "Rehabilitation Medicine",
    "keywords": [
      "physical medicine",
      "rehabilitation",
      "pmr",
      "rehab",
      "disability",
      "recovery"
    ],
    "parentSpecialty": "Physiatrist"
  },
  {
    "id": "rehabilitation-specialist",
    "name": "Rehabilitation Specialist",
    "category": "Rehabilitation Medicine",
    "keywords": [
      "rehab",
      "recovery",
      "rehabilitation",
      "disability",
      "physical medicine"
    ],
    "parentSpecialty": "Physiatrist"
  },
  {
    "id": "spinal-cord-injury-specialist",
    "name": "Spinal Cord Injury Specialist",
    "category": "Rehabilitation Medicine",
    "keywords": [
      "spinal cord",
      "paraplegia",
      "rehab",
      "rehabilitation",
      "disability",
      "physical medicine",
      "recovery"
    ],
    "parentSpecialty": "Physiatrist"
  },
  {
    "id": "amputee-rehabilitation-specialist",
    "name": "Amputee Rehabilitation Specialist",
    "category": "Rehabilitation Medicine",
    "keywords": [
      "amputee",
      "prosthesis",
      "rehab",
      "rehabilitation",
      "disability",
      "physical medicine",
      "recovery"
    ],
    "parentSpecialty": "Physiatrist"
  },
  {
    "id": "prosthetist-and-orthotist",
    "name": "Prosthetist and Orthotist",
    "category": "Rehabilitation Medicine",
    "keywords": [
      "prosthetic",
      "orthotic",
      "artificial limb",
      "rehab",
      "rehabilitation",
      "disability",
      "physical medicine",
      "recovery"
    ],
    "parentSpecialty": "Physiatrist"
  },
  {
    "id": "physiotherapist",
    "name": "Physiotherapist",
    "category": "Physiotherapy",
    "keywords": [
      "physio",
      "physiotherapy",
      "exercise",
      "mobility",
      "pain",
      "rehab"
    ],
    "parentSpecialty": "Physiotherapist"
  },
  {
    "id": "sports-physiotherapist",
    "name": "Sports Physiotherapist",
    "category": "Physiotherapy",
    "keywords": [
      "sports",
      "injury",
      "physio",
      "physiotherapy",
      "exercise",
      "mobility",
      "pain",
      "rehab"
    ],
    "parentSpecialty": "Physiotherapist"
  },
  {
    "id": "neuro-physiotherapist",
    "name": "Neuro Physiotherapist",
    "category": "Physiotherapy",
    "keywords": [
      "stroke",
      "paralysis",
      "neuro physio",
      "physiotherapy",
      "physio",
      "exercise",
      "mobility",
      "pain",
      "rehab"
    ],
    "parentSpecialty": "Physiotherapist"
  },
  {
    "id": "ortho-physiotherapist",
    "name": "Ortho Physiotherapist",
    "category": "Physiotherapy",
    "keywords": [
      "bone",
      "joint",
      "ortho physio",
      "physiotherapy",
      "physio",
      "exercise",
      "mobility",
      "pain",
      "rehab"
    ],
    "parentSpecialty": "Physiotherapist"
  },
  {
    "id": "pediatric-physiotherapist",
    "name": "Pediatric Physiotherapist",
    "category": "Physiotherapy",
    "keywords": [
      "child physio",
      "cerebral palsy",
      "physiotherapy",
      "physio",
      "exercise",
      "mobility",
      "pain",
      "rehab"
    ],
    "parentSpecialty": "Physiotherapist"
  },
  {
    "id": "cardiopulmonary-physiotherapist",
    "name": "Cardiopulmonary Physiotherapist",
    "category": "Physiotherapy",
    "keywords": [
      "chest physio",
      "breathing",
      "physiotherapy",
      "physio",
      "exercise",
      "mobility",
      "pain",
      "rehab"
    ],
    "parentSpecialty": "Physiotherapist"
  },
  {
    "id": "women-s-health-physiotherapist",
    "name": "Women's Health Physiotherapist",
    "category": "Physiotherapy",
    "keywords": [
      "pelvic floor",
      "postnatal",
      "physiotherapy",
      "physio",
      "exercise",
      "mobility",
      "pain",
      "rehab"
    ],
    "parentSpecialty": "Physiotherapist"
  },
  {
    "id": "geriatric-physiotherapist",
    "name": "Geriatric Physiotherapist",
    "category": "Physiotherapy",
    "keywords": [
      "elderly physio",
      "balance",
      "physiotherapy",
      "physio",
      "exercise",
      "mobility",
      "pain",
      "rehab"
    ],
    "parentSpecialty": "Physiotherapist"
  },
  {
    "id": "occupational-therapist",
    "name": "Occupational Therapist",
    "category": "Occupational Therapy",
    "keywords": [
      "occupational therapy",
      "ot",
      "daily living",
      "disability",
      "rehab"
    ],
    "parentSpecialty": "Occupational Therapist"
  },
  {
    "id": "pediatric-occupational-therapist",
    "name": "Pediatric Occupational Therapist",
    "category": "Occupational Therapy",
    "keywords": [
      "child therapy",
      "sensory",
      "occupational therapy",
      "ot",
      "daily living",
      "disability",
      "rehab"
    ],
    "parentSpecialty": "Occupational Therapist"
  },
  {
    "id": "hand-therapist",
    "name": "Hand Therapist",
    "category": "Occupational Therapy",
    "keywords": [
      "hand therapy",
      "wrist",
      "occupational therapy",
      "ot",
      "daily living",
      "disability",
      "rehab"
    ],
    "parentSpecialty": "Occupational Therapist"
  },
  {
    "id": "speech-therapist",
    "name": "Speech Therapist",
    "category": "Speech Therapy",
    "keywords": [
      "speech therapy",
      "stammering",
      "speech",
      "stammer",
      "stutter",
      "language",
      "voice",
      "swallowing"
    ],
    "parentSpecialty": "Speech Therapist"
  },
  {
    "id": "speech-language-pathologist",
    "name": "Speech Language Pathologist",
    "category": "Speech Therapy",
    "keywords": [
      "language",
      "swallowing",
      "slp",
      "speech",
      "stammer",
      "stutter",
      "voice"
    ],
    "parentSpecialty": "Speech Therapist"
  },
  {
    "id": "swallowing-therapist",
    "name": "Swallowing Therapist",
    "category": "Speech Therapy",
    "keywords": [
      "swallowing",
      "dysphagia",
      "speech",
      "stammer",
      "stutter",
      "language",
      "voice"
    ],
    "parentSpecialty": "Speech Therapist"
  },
  {
    "id": "sports-medicine-specialist",
    "name": "Sports Medicine Specialist",
    "category": "Sports Medicine",
    "keywords": [
      "sports injury",
      "athlete",
      "sports",
      "injury",
      "fitness",
      "muscle"
    ],
    "parentSpecialty": "Sports Medicine Specialist"
  },
  {
    "id": "exercise-medicine-specialist",
    "name": "Exercise Medicine Specialist",
    "category": "Sports Medicine",
    "keywords": [
      "exercise",
      "fitness",
      "sports",
      "athlete",
      "injury",
      "muscle"
    ],
    "parentSpecialty": "Sports Medicine Specialist"
  },
  {
    "id": "dentist",
    "name": "Dentist",
    "category": "Dental",
    "keywords": [
      "dental",
      "teeth doctor",
      "teeth",
      "tooth",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "orthodontist",
    "name": "Orthodontist",
    "category": "Dental",
    "keywords": [
      "braces",
      "aligners",
      "crooked teeth",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "endodontist",
    "name": "Endodontist",
    "category": "Dental",
    "keywords": [
      "root canal",
      "rct",
      "tooth pain",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "periodontist",
    "name": "Periodontist",
    "category": "Dental",
    "keywords": [
      "gums",
      "gum disease",
      "bleeding gums",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "prosthodontist",
    "name": "Prosthodontist",
    "category": "Dental",
    "keywords": [
      "dentures",
      "crown",
      "bridge",
      "implant teeth",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "implantologist",
    "name": "Implantologist",
    "category": "Dental",
    "keywords": [
      "dental implant",
      "tooth implant",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "cosmetic-dentist",
    "name": "Cosmetic Dentist",
    "category": "Dental",
    "keywords": [
      "smile design",
      "teeth whitening",
      "veneers",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "pediatric-dentist",
    "name": "Pediatric Dentist",
    "category": "Dental",
    "keywords": [
      "child teeth",
      "kids dentist",
      "pedodontist",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "oral-medicine-specialist",
    "name": "Oral Medicine Specialist",
    "category": "Dental",
    "keywords": [
      "oral medicine",
      "mouth ulcer",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "oral-pathologist",
    "name": "Oral Pathologist",
    "category": "Dental",
    "keywords": [
      "oral pathology",
      "mouth biopsy",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "public-health-dentist",
    "name": "Public Health Dentist",
    "category": "Dental",
    "keywords": [
      "community dental",
      "preventive dental",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "conservative-dentist",
    "name": "Conservative Dentist",
    "category": "Dental",
    "keywords": [
      "fillings",
      "restoration",
      "cavity",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "forensic-dentist",
    "name": "Forensic Dentist",
    "category": "Dental",
    "keywords": [
      "forensic odontology",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "dental-radiologist",
    "name": "Dental Radiologist",
    "category": "Dental",
    "keywords": [
      "dental xray",
      "opg",
      "teeth",
      "tooth",
      "dental",
      "dentist",
      "gum",
      "cavity",
      "oral",
      "smile"
    ],
    "parentSpecialty": "Dentist"
  },
  {
    "id": "oral-surgeon",
    "name": "Oral Surgeon",
    "category": "Oral & Maxillofacial Surgery",
    "keywords": [
      "wisdom tooth",
      "tooth extraction",
      "oral surgery",
      "jaw",
      "face surgery",
      "maxillofacial"
    ],
    "parentSpecialty": "Oral Surgeon"
  },
  {
    "id": "maxillofacial-surgeon",
    "name": "Maxillofacial Surgeon",
    "category": "Oral & Maxillofacial Surgery",
    "keywords": [
      "jaw surgery",
      "face surgery",
      "facial trauma",
      "jaw",
      "oral surgery",
      "wisdom tooth",
      "maxillofacial"
    ],
    "parentSpecialty": "Maxillofacial Surgeon"
  },
  {
    "id": "cleft-and-craniofacial-surgeon",
    "name": "Cleft and Craniofacial Surgeon",
    "category": "Oral & Maxillofacial Surgery",
    "keywords": [
      "cleft lip",
      "cleft palate",
      "jaw",
      "face surgery",
      "oral surgery",
      "wisdom tooth",
      "maxillofacial"
    ],
    "parentSpecialty": "Maxillofacial Surgeon"
  },
  {
    "id": "ayurvedic-doctor",
    "name": "Ayurvedic Doctor",
    "category": "Ayurveda",
    "keywords": [
      "ayurveda",
      "ayurvedic",
      "herbal",
      "panchakarma",
      "natural"
    ],
    "parentSpecialty": "Ayurvedic Doctor"
  },
  {
    "id": "panchakarma-specialist",
    "name": "Panchakarma Specialist",
    "category": "Ayurveda",
    "keywords": [
      "panchakarma",
      "detox",
      "therapy",
      "ayurveda",
      "ayurvedic",
      "herbal",
      "natural"
    ],
    "parentSpecialty": "Ayurvedic Doctor"
  },
  {
    "id": "ayurvedic-gynecologist",
    "name": "Ayurvedic Gynecologist",
    "category": "Ayurveda",
    "keywords": [
      "women",
      "ayurveda",
      "ayurvedic",
      "herbal",
      "panchakarma",
      "natural"
    ],
    "parentSpecialty": "Ayurvedic Doctor"
  },
  {
    "id": "ayurvedic-dermatologist",
    "name": "Ayurvedic Dermatologist",
    "category": "Ayurveda",
    "keywords": [
      "skin",
      "ayurveda",
      "ayurvedic",
      "herbal",
      "panchakarma",
      "natural"
    ],
    "parentSpecialty": "Ayurvedic Doctor"
  },
  {
    "id": "homeopathic-doctor",
    "name": "Homeopathic Doctor",
    "category": "Homeopathy",
    "keywords": [
      "homeopathy",
      "homeopathic",
      "natural",
      "alternative"
    ],
    "parentSpecialty": "Homeopathic Doctor"
  },
  {
    "id": "classical-homeopath",
    "name": "Classical Homeopath",
    "category": "Homeopathy",
    "keywords": [
      "classical homeopathy",
      "constitutional",
      "homeopathy",
      "homeopathic",
      "natural",
      "alternative"
    ],
    "parentSpecialty": "Homeopathic Doctor"
  },
  {
    "id": "naturopath",
    "name": "Naturopath",
    "category": "Naturopathy",
    "keywords": [
      "naturopathy",
      "natural healing",
      "natural",
      "wellness",
      "detox",
      "holistic"
    ],
    "parentSpecialty": "Naturopath"
  },
  {
    "id": "acupuncturist",
    "name": "Acupuncturist",
    "category": "Naturopathy",
    "keywords": [
      "acupuncture",
      "needles",
      "pain",
      "chinese medicine",
      "naturopathy",
      "natural",
      "wellness",
      "detox",
      "holistic"
    ],
    "parentSpecialty": "Acupuncturist"
  },
  {
    "id": "yoga-therapist",
    "name": "Yoga Therapist",
    "category": "Naturopathy",
    "keywords": [
      "yoga",
      "wellness",
      "breathing",
      "naturopathy",
      "natural",
      "detox",
      "holistic"
    ],
    "parentSpecialty": "Yoga Therapist"
  },
  {
    "id": "dietitian",
    "name": "Dietitian",
    "category": "Nutrition & Dietetics",
    "keywords": [
      "diet",
      "dietician",
      "nutrition",
      "weight loss",
      "food",
      "healthy eating"
    ],
    "parentSpecialty": "Dietitian"
  },
  {
    "id": "clinical-nutritionist",
    "name": "Clinical Nutritionist",
    "category": "Nutrition & Dietetics",
    "keywords": [
      "nutrition",
      "nutritionist",
      "diet plan",
      "diet",
      "weight loss",
      "food",
      "dietician",
      "healthy eating"
    ],
    "parentSpecialty": "Clinical Nutritionist"
  },
  {
    "id": "sports-nutritionist",
    "name": "Sports Nutritionist",
    "category": "Nutrition & Dietetics",
    "keywords": [
      "sports diet",
      "fitness nutrition",
      "diet",
      "nutrition",
      "weight loss",
      "food",
      "dietician",
      "healthy eating"
    ],
    "parentSpecialty": "Clinical Nutritionist"
  },
  {
    "id": "pediatric-nutritionist",
    "name": "Pediatric Nutritionist",
    "category": "Nutrition & Dietetics",
    "keywords": [
      "child nutrition",
      "child diet",
      "diet",
      "nutrition",
      "weight loss",
      "food",
      "dietician",
      "healthy eating"
    ],
    "parentSpecialty": "Clinical Nutritionist"
  },
  {
    "id": "renal-dietitian",
    "name": "Renal Dietitian",
    "category": "Nutrition & Dietetics",
    "keywords": [
      "kidney diet",
      "renal diet",
      "diet",
      "nutrition",
      "weight loss",
      "food",
      "dietician",
      "healthy eating"
    ],
    "parentSpecialty": "Dietitian"
  },
  {
    "id": "public-health-specialist",
    "name": "Public Health Specialist",
    "category": "Public Health",
    "keywords": [
      "public health",
      "community medicine",
      "community",
      "epidemiology",
      "prevention"
    ],
    "parentSpecialty": "Public Health Specialist"
  },
  {
    "id": "epidemiologist",
    "name": "Epidemiologist",
    "category": "Public Health",
    "keywords": [
      "epidemiology",
      "disease tracking",
      "public health",
      "community",
      "prevention"
    ],
    "parentSpecialty": "Public Health Specialist"
  },
  {
    "id": "occupational-health-specialist",
    "name": "Occupational Health Specialist",
    "category": "Public Health",
    "keywords": [
      "workplace",
      "occupational",
      "public health",
      "community",
      "epidemiology",
      "prevention"
    ],
    "parentSpecialty": "Public Health Specialist"
  },
  {
    "id": "preventive-medicine-specialist",
    "name": "Preventive Medicine Specialist",
    "category": "Preventive Medicine",
    "keywords": [
      "preventive",
      "screening",
      "wellness",
      "prevention",
      "checkup"
    ],
    "parentSpecialty": "Preventive Medicine Specialist"
  },
  {
    "id": "sleep-medicine-specialist",
    "name": "Sleep Medicine Specialist",
    "category": "Sleep Medicine",
    "keywords": [
      "sleep",
      "insomnia",
      "apnea",
      "snoring",
      "sleep apnea",
      "sleeplessness"
    ],
    "parentSpecialty": "Sleep Medicine Specialist"
  },
  {
    "id": "sleep-specialist",
    "name": "Sleep Specialist",
    "category": "Sleep Medicine",
    "keywords": [
      "snoring",
      "sleep study",
      "sleep",
      "insomnia",
      "sleep apnea",
      "sleeplessness"
    ],
    "parentSpecialty": "Sleep Medicine Specialist"
  },
  {
    "id": "pediatric-sleep-specialist",
    "name": "Pediatric Sleep Specialist",
    "category": "Sleep Medicine",
    "keywords": [
      "child sleep",
      "sleep",
      "insomnia",
      "snoring",
      "sleep apnea",
      "sleeplessness"
    ],
    "parentSpecialty": "Sleep Medicine Specialist"
  },
  {
    "id": "palliative-care-specialist",
    "name": "Palliative Care Specialist",
    "category": "Palliative Care",
    "keywords": [
      "palliative",
      "hospice",
      "comfort care",
      "end of life",
      "cancer care"
    ],
    "parentSpecialty": "Palliative Care Specialist"
  },
  {
    "id": "geriatrician",
    "name": "Geriatrician",
    "category": "Geriatrics",
    "keywords": [
      "elderly",
      "old age",
      "senior citizen",
      "geriatric",
      "senior",
      "aging"
    ],
    "parentSpecialty": "Geriatrician"
  },
  {
    "id": "geriatric-rehabilitation-specialist",
    "name": "Geriatric Rehabilitation Specialist",
    "category": "Geriatrics",
    "keywords": [
      "elderly rehab",
      "fall prevention",
      "elderly",
      "old age",
      "geriatric",
      "senior",
      "aging"
    ],
    "parentSpecialty": "Geriatrician"
  },
  {
    "id": "clinical-geneticist",
    "name": "Clinical Geneticist",
    "category": "Genetics",
    "keywords": [
      "genetics",
      "hereditary",
      "dna",
      "genetic",
      "inherited",
      "chromosome"
    ],
    "parentSpecialty": "Clinical Geneticist"
  },
  {
    "id": "genetic-counselor",
    "name": "Genetic Counselor",
    "category": "Genetics",
    "keywords": [
      "genetic counseling",
      "carrier",
      "genetic",
      "dna",
      "hereditary",
      "inherited",
      "chromosome"
    ],
    "parentSpecialty": "Clinical Geneticist"
  },
  {
    "id": "metabolic-disorder-specialist",
    "name": "Metabolic Disorder Specialist",
    "category": "Genetics",
    "keywords": [
      "metabolic",
      "inborn error",
      "genetic",
      "dna",
      "hereditary",
      "inherited",
      "chromosome"
    ],
    "parentSpecialty": "Clinical Geneticist"
  },
  {
    "id": "sexologist",
    "name": "Sexologist",
    "category": "Sexology",
    "keywords": [
      "sexology",
      "sexual health",
      "libido",
      "sexual",
      "erectile",
      "intimacy"
    ],
    "parentSpecialty": "Sexologist"
  },
  {
    "id": "relationship-counselor",
    "name": "Relationship Counselor",
    "category": "Sexology",
    "keywords": [
      "relationship",
      "marriage counseling",
      "sexual",
      "sexology",
      "libido",
      "erectile",
      "intimacy"
    ],
    "parentSpecialty": "Sexologist"
  },
  {
    "id": "andrologist",
    "name": "Andrologist",
    "category": "Andrology",
    "keywords": [
      "male fertility",
      "sperm",
      "male health",
      "male",
      "male infertility",
      "testosterone",
      "erectile"
    ],
    "parentSpecialty": "Andrologist"
  },
  {
    "id": "male-infertility-specialist",
    "name": "Male Infertility Specialist",
    "category": "Andrology",
    "keywords": [
      "male infertility",
      "low sperm count",
      "male",
      "sperm",
      "testosterone",
      "erectile"
    ],
    "parentSpecialty": "Andrologist"
  },
  {
    "id": "erectile-dysfunction-specialist",
    "name": "Erectile Dysfunction Specialist",
    "category": "Andrology",
    "keywords": [
      "erectile dysfunction",
      "ed",
      "impotence",
      "male",
      "male infertility",
      "sperm",
      "testosterone",
      "erectile"
    ],
    "parentSpecialty": "Andrologist"
  },
  {
    "id": "cosmetologist",
    "name": "Cosmetologist",
    "category": "Cosmetology",
    "keywords": [
      "cosmetology",
      "beauty",
      "skin care",
      "cosmetic",
      "skin",
      "laser",
      "aesthetic",
      "anti-aging"
    ],
    "parentSpecialty": "Cosmetologist"
  },
  {
    "id": "aesthetic-physician",
    "name": "Aesthetic Physician",
    "category": "Cosmetology",
    "keywords": [
      "botox",
      "filler",
      "aesthetic",
      "cosmetic",
      "beauty",
      "skin",
      "laser",
      "anti-aging"
    ],
    "parentSpecialty": "Cosmetologist"
  },
  {
    "id": "laser-specialist",
    "name": "Laser Specialist",
    "category": "Cosmetology",
    "keywords": [
      "laser hair removal",
      "laser",
      "cosmetic",
      "beauty",
      "skin",
      "aesthetic",
      "anti-aging"
    ],
    "parentSpecialty": "Cosmetologist"
  },
  {
    "id": "hair-restoration-specialist",
    "name": "Hair Restoration Specialist",
    "category": "Cosmetology",
    "keywords": [
      "hair restoration",
      "prp hair",
      "cosmetic",
      "beauty",
      "skin",
      "laser",
      "aesthetic",
      "anti-aging"
    ],
    "parentSpecialty": "Cosmetologist"
  },
  {
    "id": "wound-care-specialist",
    "name": "Wound Care Specialist",
    "category": "Wound Care",
    "keywords": [
      "wound",
      "ulcer",
      "diabetic foot",
      "dressing",
      "bedsore"
    ],
    "parentSpecialty": "Wound Care Specialist"
  },
  {
    "id": "stoma-care-specialist",
    "name": "Stoma Care Specialist",
    "category": "Wound Care",
    "keywords": [
      "stoma",
      "colostomy",
      "ostomy",
      "wound",
      "ulcer",
      "diabetic foot",
      "dressing",
      "bedsore"
    ],
    "parentSpecialty": "Wound Care Specialist"
  },
  {
    "id": "addiction-medicine-specialist",
    "name": "Addiction Medicine Specialist",
    "category": "Addiction Medicine",
    "keywords": [
      "addiction",
      "de-addiction",
      "alcohol",
      "drugs",
      "rehab",
      "smoking"
    ],
    "parentSpecialty": "Addiction Medicine Specialist"
  },
  {
    "id": "de-addiction-specialist",
    "name": "De-addiction Specialist",
    "category": "Addiction Medicine",
    "keywords": [
      "alcohol",
      "drugs",
      "rehab",
      "addiction",
      "de-addiction",
      "smoking"
    ],
    "parentSpecialty": "Addiction Medicine Specialist"
  }
];

// Category order (for grouped rendering) — first appearance order.
var CATEGORIES = [];
SPECIALTIES.forEach(function (s) { if (CATEGORIES.indexOf(s.category) === -1) CATEGORIES.push(s.category); });

function norm(s) { return String(s == null ? '' : s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }

// Search across name, category, keywords and parentSpecialty. Returns scored matches.
function search(query, limit) {
  var q = norm(query);
  if (!q) return SPECIALTIES.slice();
  var terms = q.split(' ').filter(Boolean);
  var scored = [];
  for (var i = 0; i < SPECIALTIES.length; i++) {
    var s = SPECIALTIES[i];
    var name = norm(s.name), cat = norm(s.category), parent = norm(s.parentSpecialty);
    var kw = (s.keywords || []).map(norm);
    var hay = [name, cat, parent].concat(kw).join(' ');
    var score = 0, all = true;
    for (var t = 0; t < terms.length; t++) {
      var term = terms[t], hit = 0;
      if (name === term) hit = 100;
      else if (name.indexOf(term) === 0) hit = 70;
      else if ((' ' + name).indexOf(' ' + term) !== -1) hit = 55;
      else if (name.indexOf(term) !== -1) hit = 40;
      else if (kw.some(function (k) { return k === term; })) hit = 50;
      else if (kw.some(function (k) { return k.indexOf(term) !== -1; })) hit = 30;
      else if (parent.indexOf(term) !== -1) hit = 25;
      else if (cat.indexOf(term) !== -1) hit = 20;
      else if (hay.indexOf(term) !== -1) hit = 10;
      if (!hit) { all = false; break; }
      score += hit;
    }
    if (all) scored.push({ s: s, score: score });
  }
  scored.sort(function (a, b) { return b.score - a.score || a.s.name.localeCompare(b.s.name); });
  var res = scored.map(function (x) { return x.s; });
  return (typeof limit === 'number') ? res.slice(0, limit) : res;
}

function findByName(name) {
  var n = norm(name);
  for (var i = 0; i < SPECIALTIES.length; i++) if (norm(SPECIALTIES[i].name) === n) return SPECIALTIES[i];
  return null;
}
function byId(id) {
  for (var i = 0; i < SPECIALTIES.length; i++) if (SPECIALTIES[i].id === id) return SPECIALTIES[i];
  return null;
}

return { SPECIALTIES: SPECIALTIES, CATEGORIES: CATEGORIES, search: search, findByName: findByName, byId: byId, norm: norm };
});
