import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/LegalPage";

export const metadata: Metadata = {
  title: "حذف الحساب والبيانات",
  description: "احذف حساب لولو شوب والبيانات المرتبطة به من داخل التطبيق.",
};

// This page used to say "message @lolo_shop96 to request deletion". Apple rejected
// the first iOS submission over exactly that (guideline 5.1.1(v)): an app that
// supports account creation must let the user delete the account themselves, and a
// customer-service route does not count outside highly-regulated industries.
// Deletion now happens in-app at /account; this page is the public/legal explainer
// that the privacy policy and the store listing link to, and it points straight at
// the real flow.
export default function DeleteAccountPage() {
  return (
    <LegalPage
      eyebrow="إدارة الحساب"
      title="حذف الحساب والبيانات"
      updatedAt="30 تموز 2026"
      intro="يمكنك حذف حسابك وبياناتك الشخصية بنفسك من داخل التطبيق أو الموقع، دون الحاجة إلى مراسلة أحد. الحذف نهائي ولا يمكن التراجع عنه."
      links={[{ href: "/account", label: "اذهب إلى صفحة حسابي لحذف الحساب" }]}
      sections={[
        {
          title: "طريقة الحذف",
          body: [
            "سجّل الدخول إلى حسابك، ثم افتح «حسابي» من شريط التنقل في أعلى الصفحة.",
            "في قسم «حذف الحساب» اضغط «حذف حسابي نهائياً»، ثم أدخل كلمة المرور للتأكيد. نطلب كلمة المرور حتى لا يستطيع أي شخص يمسك هاتفك حذف حسابك.",
            "يتم الحذف فوراً بمجرد التأكيد، ويتم تسجيل خروجك من كل الأجهزة في نفس اللحظة.",
          ],
        },
        {
          title: "ما الذي يُحذف",
          body: [
            "اسمك، رقم هاتفك، بريدك الإلكتروني، وكلمة المرور — بعدها لا يمكن تسجيل الدخول إلى الحساب مرة أخرى.",
            "بيانات ملفك الطلابي: الاسم الثلاثي، الجامعة، القسم، وحساب إنستقرام.",
            "سلة التسوق، الإشعارات، ورموز التحقق والأجهزة الموثوقة المرتبطة بالحساب.",
            "رقم هاتفك يصبح متاحاً من جديد، فيمكنك إنشاء حساب جديد بنفس الرقم لاحقاً إذا أردت.",
          ],
        },
        {
          title: "ما الذي نحتفظ به ولماذا",
          body: [
            "نحتفظ بسجل الطلبات التي تم شراؤها فعلاً (المنتج، السعر، تاريخ الطلب) لأنها سجل بيع ومحاسبة يخص المتجر، وقد نحتاجه لحل نزاع أو لمراجعة حسابية لاحقاً.",
            "إذا كان لديك طلب قيد التنفيذ وقت الحذف، فإن حذف الحساب لا يلغي الطلب: يبقى اسم التسليم ورقم التواصل المسجّلان على الطلب نفسه حتى نتمكن من إكمال تطريزه وتسليمه لك.",
            "إذا أردت إلغاء طلب قيد التنفيذ أيضاً، ألغِه قبل حذف الحساب أو راجعنا بخصوصه.",
          ],
        },
      ]}
    />
  );
}
