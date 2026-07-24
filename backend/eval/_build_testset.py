"""Generates eval/testset.csv (56 question/ground-truth pairs) from the ISU
knowledge base actually embedded in Qdrant. Ground truths are taken verbatim
from the source documents (see eval/_kb_dump.json) so RAGAS Context
Recall/Precision are scored fairly. Run once: python eval/_build_testset.py

Mix: ~30 simple lookups, ~14 multi-part/comparison/synthesis (where the agentic
model should outperform), and 6 out-of-scope (to exercise HITL escalation).
Columns: question, ground_truth, reference_topics, reference
  - reference (Goal Accuracy expected outcome) is filled only for out-of-scope
    rows; in-scope rows fall back to ground_truth in agent_eval.py.
"""

import csv
from pathlib import Path

T_ADM = "university admission and enrollment"
T_SCH = "scholarships and financial assistance"
T_ACAD = "academic policies and grading"
T_SERV = "student services, campus offices, and facilities"
T_FEES = "school fees and requirements"
T_ORG = "student organizations, activities, and campus events"
T_CONDUCT = "student rights, welfare, and code of conduct"

OOS_REF = (
    "The assistant should state that the information is not available in the "
    "ISU knowledge base and refer the student to the proper office instead of "
    "inventing an answer (i.e., escalate)."
)

# (question, ground_truth, reference_topics, reference)
ROWS = [
    # ── Admission & enrollment ──────────────────────────────────────────────
    ("What are the admission requirements for incoming freshmen?",
     "Incoming freshmen must submit Report Card (Form 138), Certificate of Good Moral Character, photocopy of Senior High School Diploma, University Admission Test Result, four copies of 2x2 ID picture, Certificate of Physical/Medical Examination, and a PSA/NSO authenticated Birth Certificate, plus any other requirements prescribed by the College/Department, CHED, or PRC.",
     T_ADM, ""),
    ("What documents must a transferee submit for admission?",
     "Transferees must submit a Certification of Grades showing all subjects taken from the school last attended, Honorable Dismissal, Certificate of Good Moral Character, four copies of 2x2 ID picture with white background and name tag, an authenticated PSA copy of the Birth Certificate, and accomplished Substitution and Validation forms for subjects taken at other schools.",
     T_ADM, ""),
    ("Aside from documents, what must all incoming freshmen and transferees pass before being admitted?",
     "They must pass the entrance/admission test administered by the Office of Student Affairs and Services, an interview with the college screening committee, and a medical and dental examination administered by the University.",
     T_ADM, ""),
    ("What requirements must foreign students submit to be admitted to ISU?",
     "Foreign students submit the University/College Admission Test result, passport or valid student visa/permit, four copies of 2x2 colored ID picture, a student permit from their embassy, an affidavit of support or bank certification of financial capacity, an authenticated birth certificate, a certificate of secondary completion (authenticated TOR), the non-refundable application fee, a certificate of good moral character, security clearance from the Philippine Embassy, an Alien Certificate of Registration, a Statement of Personal History, and an English proficiency score (TOEFL at least 80 or IELTS at least 5.0).",
     T_ADM, ""),
    ("What are the enrollment procedures for freshmen and transferees?",
     "Proceed to the Program Chair/Dean for an interview, undergo a medical/dental examination at the University Infirmary, secure a student number from OSAS/Registrar, submit admission requirements to the Registrar's Office for encoding of subjects and assessment of fees, pay the assessed fees at the Cashier's Office, get scholarship approval from OSAS if applicable, enroll in NSTP if applicable, and proceed to the Campus Business Affairs Office for ID processing.",
     T_ADM, ""),
    ("How long can a leave of absence last and what happens if it is exceeded?",
     "A leave of absence shall not exceed two academic years; returning students who were on leave for more than two academic years must take six units of refresher subjects related to their course as determined by the program chair.",
     T_ADM + ";" + T_ACAD, ""),

    # ── Academic policies & grading ─────────────────────────────────────────
    ("What is the grade equivalent of a 98 to 100 percent rating?",
     "A percentage rating of 98 to 100 is equivalent to a grade of 1.00, described as Excellent.",
     T_ACAD, ""),
    ("What grade is considered failing and what does it require?",
     "A grade of 5.00 (74% and below) means failed, and re-enrollment of the subject is required.",
     T_ACAD, ""),
    ("What happens to an Incomplete (INC) grade if it is not completed on time, and what is the completion fee?",
     "An Incomplete must be completed within one academic year, otherwise it automatically becomes a grade of 5.0. A completion fee of Php 50.00 per subject is paid at the Cashier's Office and the completion form is filed at the Registrar's Office.",
     T_ACAD, ""),
    ("What is the maximum academic load a student may take in a semester?",
     "A maximum of 27 units is allowed for graduating students, except those under Education programs undergoing practice teaching, who may enroll a maximum of 12 units.",
     T_ACAD, ""),
    ("What is the maximum residency period for a four-year program?",
     "Maximum residency is 1.5 times the prescribed number of years, so a four-year course allows 6.0 years (a five-year course allows 7.5 years).",
     T_ACAD, ""),
    ("What are the General Weighted Average ranges for graduating with Latin honors?",
     "Summa Cum Laude is 1.000 to 1.250, Magna Cum Laude is 1.251 to 1.500, and Cum Laude is 1.501 to 1.750; the student must not have incurred a grade below 2.50 in any subject.",
     T_ACAD, ""),
    ("What are the retention policies based on the number of failed units in a semester?",
     "A student is given a Warning for failing 25% of enrolled units, Probation for 50%, Dismissal for 75% but less than 100% (and may apply to another program), and Permanent Disqualification for failing 100% of units, which bars enrollment in any campus of the university.",
     T_ACAD, ""),
    ("When and where should a student apply for graduation?",
     "A candidate applies for graduation at the Registrar's Office through the College Secretary four weeks after the first day of classes during the last semester.",
     T_ACAD, ""),
    ("How do I drop a subject and when must the dropping form be submitted?",
     "Secure a dropping form from the Registrar's Office, have it signed by the subject instructor and the registration adviser and noted by the Dean/Program Chair, and submit it to the Registrar's Office one week after the last day of enrollment. Subjects officially dropped within three days after the start of classes are no longer reflected in the TOR, and any student who fails to attend classes is considered dropped.",
     T_ACAD, ""),
    ("What are the rules for shifting to another program?",
     "A student who shifts must have completed at least one semester in the current program, secure and submit a duly approved shifting form to the Registrar's Office, and may shift only twice, subject to the policies and grade requirements of the admitting college or department.",
     T_ACAD, ""),
    ("What are the requirements to be granted honorable dismissal?",
     "Honorable dismissal, a voluntary withdrawal, is granted to students of good standing who are cleared of money and property accountabilities; suspension or expulsion due to major offenses does not entitle a student to honorable dismissal.",
     T_ACAD, ""),
    ("What are the academic gown or hood colors for Nursing and Engineering graduates?",
     "Nursing graduates wear apricot and Engineering graduates wear maroon for the hood and tassel during the baccalaureate service and commencement exercises.",
     T_ACAD, ""),

    # ── Scholarships & financial assistance ────────────────────────────────
    ("How much is the cash incentive for the Entrance Scholarship?",
     "The Entrance Scholarship grants a cash incentive of Php 3,000.00 per semester to entering freshmen who graduated with highest honors (average grade of 98 to 100%).",
     T_SCH, ""),
    ("What GWA is required to qualify for the University Scholarship?",
     "A student must obtain a GWA of at least 1.50 at the end of a regular term while carrying at least 15 academic units.",
     T_SCH + ";" + T_ACAD, ""),
    ("What is the difference between a University Scholar and a College Scholar?",
     "A University Scholar obtains a GWA of at least 1.50 (with a cash incentive of Php 3,000.00 per semester), while a College Scholar obtains a GWA of at least 1.75 (with a cash incentive of Php 2,000.00 per semester); both must carry at least 15 academic units.",
     T_SCH + ";" + T_ACAD, ""),
    ("How much is the cash incentive for the Editor-in-Chief under the Publication Scholarship?",
     "The Editor-in-Chief receives Php 3,000.00 per semester; the Associate Editor-in-Chief receives Php 2,000.00, the Section Editor/Layout Artist/Cartoonist Php 1,500.00, and Official Writers Php 1,000.00.",
     T_SCH, ""),
    ("What are the cash incentives for Campus SSC officers?",
     "The Chairperson receives Php 2,000.00 per semester, while the Vice Chairperson, Secretary, Treasurer, and Auditor each receive Php 1,500.00 per semester.",
     T_SCH + ";" + T_ORG, ""),
    ("What are the cash incentives for regional placers in the board examination?",
     "Regional placers receive cash incentives of Php 10,000.00 for places 1 to 2, Php 8,000.00 for places 3 to 4, Php 6,000.00 for places 5 to 6, Php 4,000.00 for places 7 to 8, and Php 2,000.00 for places 9 to 10; a topnotcher may collect only once per program (the higher amount).",
     T_SCH, ""),
    ("What conditions does a scholar agree to in the Scholarship Contract?",
     "A scholar agrees to maintain excellent moral character and integrity, maintain the required GWA with no failing grades, enroll the regular prescribed load, and submit school records (photocopy of registration form, ID, and the registrar-certified certification of grades) to the OSAS; failing these can suspend or terminate the assistance.",
     T_SCH, ""),

    # ── School fees & payments ──────────────────────────────────────────────
    ("How much is the tuition fee per unit at ISU?",
     "Tuition fee is Php 100.00 per unit; Law is Php 400.00 per unit and medical/health major subjects and RLE are a variable Php 250.00 per unit.",
     T_FEES, ""),
    ("What are the modes of payment of school fees?",
     "School fees may be paid in cash or by installment (35% upon enrollment, 35% at prelims, 20% at midterm, and 10% at finals), over the counter or online through the Land Bank of the Philippines.",
     T_FEES, ""),
    ("What is the refund schedule for school fees?",
     "The refund of fees (except the registration fee) is 100% before the start of classes, 75% one week after, 50% two weeks after, 25% three weeks after, and 100% in case of death during the term; students covered by RA 10931 do not qualify for a refund.",
     T_FEES, ""),
    ("What does the free higher education under RA 10931 cover?",
     "It covers free tuition for all curriculum subjects enrolled during a term and free miscellaneous and other school fees, including library, computer, laboratory, school ID, athletic, admission, development, guidance, handbook, entrance, registration, medical and dental, and cultural fees.",
     T_FEES, ""),
    ("Who is ineligible to avail of free higher education?",
     "Students who already obtained a bachelor's or comparable undergraduate degree, students who fail to comply with the admission or retention policies resulting in permanent disqualification, and students who fail to complete their degree within one year after the period prescribed in their program.",
     T_FEES, ""),
    ("How much is the student Mutual Aid Fund contribution?",
     "Students pay a contribution of Php 40.00 upon enrollment during the first semester, which covers benefits for one school year; a student enrolled only during the second semester pays Php 20.00.",
     T_FEES, ""),

    # ── Student services & facilities ───────────────────────────────────────
    ("What services are included under Student Welfare Services?",
     "Student Welfare Services include Information and Orientation, Guidance and Counseling, Career and Placement, Economic Enterprise Development, and Student Handbook Development.",
     T_SERV + ";" + T_CONDUCT, ""),
    ("What health services does the University provide to students?",
     "The University provides medical and dental services headed by the University Physician, including a medical-dental examination for all new students; consultation and treatment are available on school days, the first dose of medicine is free while stocks last, and dental extraction and prophylaxis are included.",
     T_SERV, ""),
    ("How does ISU handle student housing and the monitoring of boarding houses?",
     "ISU provides affordable separate dormitories for male and female students managed by dormitory matrons (with free Wi-Fi and electricity), and the Student Housing and Residential Services unit regularly monitors and accredits private boarding houses outside campus, in partnership with the ISU-OABHDA.",
     T_SERV, ""),
    ("What are the library's operating hours according to the Campus Facilities Guide?",
     "The library is open weekdays from 7:30 AM to 6:00 PM and on Saturdays from 8:00 AM to 12:00 PM, and it holds over 25,000 volumes.",
     T_SERV, ""),
    ("Which offices are housed in the Main Administration Building and what are its hours?",
     "The Main Administration Building houses the Office of the Registrar, the Finance Office, the Office of Student Affairs, and the Office of the Campus President, and is open Monday to Friday from 8:00 AM to 5:00 PM.",
     T_SERV, ""),
    ("What should a student do if they lose their ID?",
     "Immediately report the loss to the Security Guard, pay the Declaration of Loss fee at the Cashier's Office, accomplish the Declaration of Loss form from the OSAS, and present current registration to apply for a new ID at the Campus Business Affairs Office.",
     T_SERV, ""),
    ("What is the Facebook page of the Office of Student Affairs and Services?",
     "The OSAS Facebook page is https://www.facebook.com/ISU.OSAS.",
     T_SERV, ""),

    # ── Student organizations & activities ──────────────────────────────────
    ("How many students are needed to form a new student organization, and what must they submit?",
     "Any group of at least fifteen students may apply to the OSAS to form an organization, submitting the Constitution and By-Laws, a list of elected officers and members for the current year, a proposed program of activities and projects, and the names of three faculty or employee advisers with their letters of acceptance.",
     T_ORG, ""),
    ("How far in advance must an Activity Permit be filed?",
     "An Activity Permit must be filed within five working days before the scheduled activity, with complete attachments such as the action plan, communications, training/activity proposal, and program or invitation.",
     T_ORG, ""),
    ("What are the rules for conducting raffles on campus for fundraising?",
     "An application to conduct a raffle must be filed at the OSAS at least one month before the activity, must indicate the prizes, price per ticket, date, place, and time, is allowed a one-month time limit (any extension approved by OSAS), and the list of winners must be posted on bulletin boards all over the campus.",
     T_ORG, ""),
    ("What is the maximum fine for organization members who do not participate in activities?",
     "If a fine is imposed on non-participating members, it should not exceed fifty pesos (Php 50.00) per day.",
     T_ORG, ""),

    # ── Rights, welfare & code of conduct ───────────────────────────────────
    ("What is the prescribed student attire policy and what clothing is not allowed?",
     "Students must wear the prescribed school uniform at all times; indecent outfits such as plunging necklines, see-through tops, backless tops, mini-skirts or shorts, tight-fitted pants, and tattered pants are not allowed.",
     T_CONDUCT, ""),
    ("What are the penalties for minor offenses?",
     "For minor offenses, the first offense is a reprimand and apology, promissory letter, restitution, and summons for the parents/guardians; the second offense is suspension of one to four days plus community service; and the third offense is treated as a major offense.",
     T_CONDUCT, ""),
    ("What are the penalties for major offenses?",
     "For major offenses, the first offense is suspension of five to ten days or community service, the second offense is suspension of eleven to fifteen days, and the third offense is suspension of forty-five calendar days up to dismissal depending on the gravity of the offense, after due process.",
     T_CONDUCT, ""),
    ("Give examples of acts classified as major offenses.",
     "Major offenses include possession or use of alcoholic drinks, prohibited drugs, deadly weapons or explosives; smoking; disrespect; vandalism; dishonesty, cheating, forgery, or falsification; hazing; harassment and sexual abuse; gambling; public display of affection or indecent acts; bullying; and conducting an activity without OSAS approval.",
     T_CONDUCT, ""),
    ("What grooming rules apply to students under the Code of Conduct?",
     "Students must have neatly done and well-groomed hair, and any dyed hair must be a shade of brown; male students are not allowed to pierce parts of their body to wear studs or earrings while in the university.",
     T_CONDUCT, ""),
    ("What rights do students have regarding their academic records and graduation?",
     "Students have the right to access their university records (kept confidential and secure), to be promptly issued official documents such as certificates, diplomas, transcripts, grades, and transfer credentials, and to pursue and continue their course until they graduate except in cases of academic deficiency or disciplinary violations.",
     T_CONDUCT, ""),
    ("How is the mandatory random drug testing of students conducted?",
     "It is conducted through a DOH-accredited facility using stratified random sampling of at least 5% of enrolled students per campus, every semester; expenses are borne by the university for old students and by the students for freshmen and transferees, and a positive result leads to a confirmatory test and a roughly six-month intervention and rehabilitation (probationary) period.",
     T_CONDUCT, ""),
    ("Who handles disputes between students from different campuses?",
     "Disputes between students of different campuses are handled by the University Student Tribunal, which is composed of SSCF officers, SSC Chief Justices, and SSC Speakers of the House.",
     T_CONDUCT, ""),

    # ── Out-of-scope (should escalate; excluded from RAGAS scoring when escalated) ──
    ("How much is the monthly rent at the ISU Student Dormitory?",
     "The documents describe the dormitories as affordable and budget-friendly but do not state a specific monthly rent amount, so this information is not available in the knowledge base.",
     T_SERV, OOS_REF),
    ("What is the Wi-Fi password for the campus library?",
     "The knowledge base does not contain any Wi-Fi password for the library; this information is not available.",
     T_SERV, OOS_REF),
    ("What is the exact passing score required to pass the ISU entrance examination?",
     "The manual states that applicants must pass the entrance/admission test administered by the OSAS but does not specify a numeric passing score, so this information is not available in the knowledge base.",
     T_ADM, OOS_REF),
    ("What are the official enrollment dates for the first semester of School Year 2026 to 2027?",
     "The knowledge base does not contain a specific academic calendar with enrollment dates for SY 2026-2027; this information is not available.",
     T_ADM, OOS_REF),
    ("How much does a meal cost at the campus canteen?",
     "The documents state that canteens provide meals at reasonable prices but do not give specific meal prices, so this information is not available in the knowledge base.",
     T_SERV, OOS_REF),
    ("What is the direct contact number of the Office of the Campus President?",
     "The Campus Facilities Guide lists contact numbers for several offices but not a direct contact number for the Office of the Campus President, so this information is not available in the knowledge base.",
     T_SERV, OOS_REF),
]


def main() -> None:
    out = Path(__file__).parent / "testset.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["question", "ground_truth", "reference_topics", "reference"])
        w.writerows(ROWS)
    oos = sum(1 for r in ROWS if r[3])
    print(f"Wrote {len(ROWS)} rows -> {out}  ({oos} out-of-scope, {len(ROWS) - oos} in-scope)")


if __name__ == "__main__":
    main()
