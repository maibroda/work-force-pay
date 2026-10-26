/**
 * The ThreeRoots demo pipeline: two referral partners, leads at every stage (the demo client itself is the one that was won, so its commission
 * can be seen), and a fortnight of outreach by the demo sales person. Built through the same services the screens use.
 */
import type { Ctx } from "../src/lib/auth/context";
import { isWorkingDay } from "../src/lib/payroll-reminders";
import { createLead, createPartner, logOutreach, moveLead, recordPayout } from "../src/server/services/crm";
import { approveBelowMargin, confirmRateCard, createProposal, sendProposal } from "../src/server/services/proposals";

const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

export async function buildDemoPipeline(o: { sales: Ctx; founder: Ctx; clientId: string }) {
  const { sales } = o;
  const ade = await createPartner(sales, { name: "Ade & Co Accountants", kind: "ACCOUNTANT", contactName: "Mr Ade Williams", email: "ade@adeco.test", commissionPct: 10, commissionMonths: 12 });
  const people = await createPartner(sales, { name: "PeopleFirst HR Consulting", kind: "HR_CONSULTANT", contactName: "Mrs Nkechi Obi", email: "nkechi@peoplefirst.test", commissionPct: 7.5, commissionMonths: 6 });

  const acme = await createLead(sales, { company: "Acme Facilities Ltd", segment: "SECURITY_FACILITIES", headcount: 30, partnerId: ade.id, contactName: "Mrs Funmi Bello", contactRole: "Finance Director", expectedMrr: 75000, notes: "First client: 30 staff over three sites." });
  for (const to of ["DISCOVERY", "PROPOSAL", "PILOT"] as const) await moveLead(sales, acme.id, { to });
  await moveLead(sales, acme.id, { to: "WON", note: "Signed after a one-month pilot", clientOrganizationId: o.clientId });
  await recordPayout(sales, { partnerId: ade.id, leadId: acme.id, amount: 30000, paidOn: day(1), reference: "Transfer to Ade & Co, first instalment" });

  const guardian = await createLead(sales, { company: "Guardian Shield Security", segment: "SECURITY_FACILITIES", headcount: 120, contactName: "Col. Ibrahim Musa", contactRole: "Managing Director", expectedMrr: 300000, nextStep: "Walk them through the proposal", nextStepOn: day(-3) });
  await moveLead(sales, guardian.id, { to: "DISCOVERY" });
  await moveLead(sales, guardian.id, { to: "PROPOSAL" });
  const lekki = await createLead(sales, { company: "Lekki Logistics", segment: "SME", headcount: 45, partnerId: people.id, contactName: "Mr Tayo Adeleke", contactRole: "HR Manager", expectedMrr: 112500, nextStep: "Second discovery call on overtime rules", nextStepOn: day(-1) });
  await moveLead(sales, lekki.id, { to: "DISCOVERY" });
  await createLead(sales, { company: "BrightPath Schools", segment: "SME", headcount: 60, source: "INBOUND", contactName: "Mrs Ada Eze", contactRole: "Bursar", expectedMrr: 150000, nextStep: "Book a discovery meeting", nextStepOn: day(-2) });
  const sunrise = await createLead(sales, { company: "Sunrise Clinic", segment: "SME", headcount: 35, source: "EVENT", contactName: "Dr Kunle Bakare", expectedMrr: 87500 });
  for (const to of ["DISCOVERY", "PROPOSAL", "PILOT"] as const) await moveLead(sales, sunrise.id, { to });
  const north = await createLead(sales, { company: "Northgate Foods", segment: "SME", headcount: 80, contactName: "Mr Sam Okon", expectedMrr: 200000 });
  await moveLead(sales, north.id, { to: "DISCOVERY" });
  await moveLead(sales, north.id, { to: "LOST", lostReason: "Chose to keep payroll in-house for another year" });

  // proposals: the demo bureau confirms its (illustrative) rate card so offers can go out; one is a draft below the target margin, one was
  // priced below it, approved with a reason and sent
  await confirmRateCard(o.founder, "Demo rate card: illustrative figures, confirmed for the demo only");
  const offer = await createProposal(sales, guardian.id, { packageKey: "ENTERPRISE", headcount: 120, termMonths: 12, addOnCodes: ["REPORTS"] });
  await sendProposal(sales, offer.id);
  await createProposal(sales, lekki.id, { packageKey: "PAYROLL_COMPLIANCE", headcount: 45, termMonths: 12 });
  const pilot = await createProposal(sales, sunrise.id, { packageKey: "PAYROLL_COMPLIANCE", headcount: 35, termMonths: 6, discountPct: 10, discountReason: "Three-month pilot price" });
  await approveBelowMargin(o.founder, pilot.id, "Pilot price for three months; the fee goes to the list price if they continue");
  await sendProposal(sales, pilot.id);

  // outreach over the last fortnight's working days: more on some days than others, so the target gauge has something to show
  const outcomes = ["CONNECTED", "NO_ANSWER", "NO_ANSWER", "CONNECTED", "MEETING_BOOKED", "NO_ANSWER", "NOT_INTERESTED", "CONNECTED", "NO_ANSWER", "QUALIFIED"] as const;
  const channels = ["CALL", "EMAIL", "WHATSAPP", "LINKEDIN", "CALL"] as const;
  let n = 0;
  for (let back = 12; back >= 0; back--) {
    const date = day(back);
    if (!isWorkingDay(date)) continue;
    const entries = back === 0 ? 6 : 8 + ((back * 3) % 6);
    for (let k = 0; k < entries; k++, n++)
      await logOutreach(sales, { company: `Prospect ${n + 1} Ltd`, contactName: "Operations lead", channel: channels[n % channels.length], outcome: outcomes[n % outcomes.length], date });
  }
}
