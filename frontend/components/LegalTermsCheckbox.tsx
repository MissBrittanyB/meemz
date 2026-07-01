import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

/**
 * Required EULA + Privacy Policy acceptance checkbox for auth screens.
 *
 * Renders a checkbox with tappable EULA and Privacy Policy links.
 * Tapping a link opens a full-screen modal with the complete legal text.
 * The parent screen should disable the submit button unless `accepted === true`.
 */
interface LegalTermsCheckboxProps {
  accepted: boolean;
  onToggle: (next: boolean) => void;
  mode?: "login" | "register";
}

type LegalDoc = "eula" | "privacy" | null;

export default function LegalTermsCheckbox({
  accepted,
  onToggle,
  mode = "login",
}: LegalTermsCheckboxProps) {
  const [openDoc, setOpenDoc] = useState<LegalDoc>(null);

  const actionLabel = mode === "register" ? "creating an account" : "signing in";

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity
        style={styles.row}
        onPress={() => onToggle(!accepted)}
        activeOpacity={0.7}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel="I agree to the End User License Agreement and Privacy Policy"
      >
        <View style={[styles.box, accepted && styles.boxChecked]}>
          {accepted && <Ionicons name="checkmark" size={18} color="#fff" />}
        </View>
        <Text style={styles.label}>
          <Text style={styles.labelDim}>By {actionLabel}, I agree to the{" "}</Text>
          <Text
            style={styles.link}
            onPress={() => setOpenDoc("eula")}
            suppressHighlighting
          >
            End User License Agreement (EULA)
          </Text>
          <Text style={styles.labelDim}>{" "}and{" "}</Text>
          <Text
            style={styles.link}
            onPress={() => setOpenDoc("privacy")}
            suppressHighlighting
          >
            Privacy Policy
          </Text>
          <Text style={styles.labelDim}>.</Text>
        </Text>
      </TouchableOpacity>

      <Modal
        visible={openDoc !== null}
        animationType="slide"
        presentationStyle={Platform.OS === "ios" ? "pageSheet" : "fullScreen"}
        onRequestClose={() => setOpenDoc(null)}
      >
        <SafeAreaView style={styles.modalContainer} edges={["top"]}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {openDoc === "eula" ? "End User License Agreement" : "Privacy Policy"}
            </Text>
            <TouchableOpacity
              onPress={() => setOpenDoc(null)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              accessibilityLabel="Close"
            >
              <Ionicons name="close" size={26} color="#EAEAF0" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            {openDoc === "eula" ? <EULAContent /> : <PrivacyContent />}
          </ScrollView>
          <View style={styles.modalFooter}>
            <TouchableOpacity
              style={styles.agreeButton}
              onPress={() => {
                onToggle(true);
                setOpenDoc(null);
              }}
              activeOpacity={0.85}
            >
              <Text style={styles.agreeButtonText}>I Agree</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function EULAContent() {
  return (
    <View>
      <Text style={styles.docHeading}>meemz End User License Agreement</Text>
      <Text style={styles.docMeta}>Effective Date: June 2026</Text>

      <Text style={styles.sectionHeading}>1. Acceptance of Terms</Text>
      <Text style={styles.paragraph}>
        By downloading, installing, or using the meemz application (the &quot;App&quot;),
        you agree to be bound by this End User License Agreement (&quot;EULA&quot;).
        If you do not agree to these terms, do not use the App.
      </Text>

      <Text style={styles.sectionHeading}>2. License</Text>
      <Text style={styles.paragraph}>
        meemz grants you a personal, non-exclusive, non-transferable, revocable
        license to install and use the App on devices you own or control, solely
        for your personal, non-commercial use, subject to the terms of this EULA.
      </Text>

      <Text style={styles.sectionHeading}>3. Community Guidelines &amp; Zero Tolerance Policy</Text>
      <Text style={styles.paragraph}>
        meemz is committed to maintaining a safe and respectful community.{" "}
        <Text style={styles.paragraphStrong}>
          There is no tolerance for objectionable content or abusive behavior.
          Users who post objectionable content or engage in abusive behavior
          will have their accounts terminated.
        </Text>
      </Text>
      <Text style={styles.paragraph}>
        Objectionable content includes, but is not limited to: hate speech,
        harassment, threats, sexually explicit material, violence, discrimination,
        content that infringes intellectual property rights, spam, scams, and
        any content that is unlawful or harmful to minors.
      </Text>

      <Text style={styles.sectionHeading}>4. User-Generated Content</Text>
      <Text style={styles.paragraph}>
        You are solely responsible for any content you upload, post, or share
        through the App. You retain ownership of your content but grant meemz
        a worldwide, royalty-free license to host, display, and distribute
        your content within the App.
      </Text>

      <Text style={styles.sectionHeading}>5. Reporting &amp; Moderation</Text>
      <Text style={styles.paragraph}>
        You may report objectionable content or abusive users at any time from
        within the App. Reports are reviewed within 24 hours and action is
        taken as appropriate, including content removal and account termination.
        You may also block any user to prevent further interaction.
      </Text>

      <Text style={styles.sectionHeading}>6. Account Termination</Text>
      <Text style={styles.paragraph}>
        meemz reserves the right to suspend or permanently terminate any
        account that violates this EULA, without prior notice. Repeated or
        severe violations will result in permanent removal from the platform.
      </Text>

      <Text style={styles.sectionHeading}>7. Subscriptions &amp; Payments</Text>
      <Text style={styles.paragraph}>
        Optional paid subscriptions are billed through the Apple App Store
        (in-app purchase), Google Play, or Stripe, depending on your platform.
        Subscriptions auto-renew unless canceled at least 24 hours before the
        end of the current period. Manage or cancel subscriptions in your
        platform account settings.
      </Text>

      <Text style={styles.sectionHeading}>8. Disclaimer of Warranties</Text>
      <Text style={styles.paragraph}>
        The App is provided &quot;as is&quot; without warranty of any kind, either
        express or implied, including but not limited to fitness for a particular
        purpose and non-infringement.
      </Text>

      <Text style={styles.sectionHeading}>9. Limitation of Liability</Text>
      <Text style={styles.paragraph}>
        To the maximum extent permitted by law, meemz shall not be liable for
        any indirect, incidental, special, or consequential damages arising
        from your use of the App.
      </Text>

      <Text style={styles.sectionHeading}>10. Changes to this EULA</Text>
      <Text style={styles.paragraph}>
        meemz may update this EULA from time to time. Continued use of the App
        after changes are posted constitutes acceptance of the revised terms.
      </Text>

      <Text style={styles.sectionHeading}>11. Contact</Text>
      <Text style={styles.paragraph}>
        Questions about this EULA can be sent to support@meemzai.com.
      </Text>
    </View>
  );
}

function PrivacyContent() {
  return (
    <View>
      <Text style={styles.docHeading}>meemz Privacy Policy</Text>
      <Text style={styles.docMeta}>Effective Date: June 2026</Text>

      <Text style={styles.sectionHeading}>1. Information We Collect</Text>
      <Text style={styles.paragraph}>
        We collect information you provide when you create an account (email,
        username, password), content you upload (memes, images, videos), and
        limited usage data (favorites, recently viewed items) to power the App.
      </Text>

      <Text style={styles.sectionHeading}>2. How We Use Your Information</Text>
      <Text style={styles.paragraph}>
        We use your information to operate the App, personalize your experience,
        moderate content, process subscriptions, communicate important account
        updates, and improve the service.
      </Text>

      <Text style={styles.sectionHeading}>3. Sharing</Text>
      <Text style={styles.paragraph}>
        We do not sell your personal information. Content marked as public
        (memes, username, avatar, bio) is visible to other users. Subscription
        billing information is handled by Apple, Google, or Stripe and is not
        stored on our servers.
      </Text>

      <Text style={styles.sectionHeading}>4. Data Security</Text>
      <Text style={styles.paragraph}>
        Passwords are stored using industry-standard hashing. Communications
        with our servers use HTTPS. Despite our safeguards, no system is 100%
        secure.
      </Text>

      <Text style={styles.sectionHeading}>5. Your Rights</Text>
      <Text style={styles.paragraph}>
        You may edit your profile, delete content, block users, or permanently
        delete your account and all associated data from the Profile screen at
        any time.
      </Text>

      <Text style={styles.sectionHeading}>6. Children</Text>
      <Text style={styles.paragraph}>
        meemz is not directed to children under 13. We do not knowingly collect
        personal information from children under 13.
      </Text>

      <Text style={styles.sectionHeading}>7. Changes</Text>
      <Text style={styles.paragraph}>
        We may update this Privacy Policy from time to time. Material changes
        will be highlighted in the App.
      </Text>

      <Text style={styles.sectionHeading}>8. Contact</Text>
      <Text style={styles.paragraph}>
        Privacy questions: privacy@meemzai.com
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 4,
    marginBottom: 16,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 4,
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#3A3A44",
    backgroundColor: "#15151A",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  boxChecked: {
    backgroundColor: "#FF7A1A",
    borderColor: "#FF7A1A",
  },
  label: {
    flex: 1,
    color: "#EAEAF0",
    fontSize: 13,
    lineHeight: 19,
  },
  labelDim: {
    color: "#B8B8C2",
  },
  link: {
    color: "#FF7A1A",
    fontWeight: "600",
    textDecorationLine: "underline",
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "#0B0B0F",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#1E1E24",
  },
  modalTitle: {
    color: "#EAEAF0",
    fontSize: 18,
    fontWeight: "700",
    flex: 1,
    paddingRight: 12,
  },
  modalBody: {
    padding: 20,
    paddingBottom: 40,
  },
  docHeading: {
    color: "#EAEAF0",
    fontSize: 22,
    fontWeight: "700",
    marginBottom: 4,
  },
  docMeta: {
    color: "#777",
    fontSize: 13,
    marginBottom: 20,
  },
  sectionHeading: {
    color: "#EAEAF0",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 18,
    marginBottom: 8,
  },
  paragraph: {
    color: "#C7C7D0",
    fontSize: 14,
    lineHeight: 21,
    marginBottom: 8,
  },
  paragraphStrong: {
    color: "#FFB07A",
    fontWeight: "700",
  },
  modalFooter: {
    padding: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#1E1E24",
    backgroundColor: "#0B0B0F",
  },
  agreeButton: {
    backgroundColor: "#FF7A1A",
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
  },
  agreeButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
