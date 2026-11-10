-- Reverses 20261206090000_skills_and_gaps. Everything it added is new, so nothing that existed before is touched.
-- Dropping the tables removes any skills, role requirements and assessments recorded since (take a backup first if any matter).
DROP TABLE "SkillAssessment";
DROP TABLE "RoleSkill";
DROP TABLE "Skill";
ALTER TABLE "HrPolicy" DROP COLUMN "skillReassessDays";
