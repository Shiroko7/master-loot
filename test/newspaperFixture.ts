import type { LootDocument } from "../src/types";

export function newspaperRegressionFixture(): LootDocument {
  const page1Text = `The neglected sect founder's wife who traded an absentee husband for her handmaiden.

Before Sirius tamed the chaotic frontier, the Vast Cold domain knew only relentless bloodshed. Great nations collapsed and grand sects burned, as entire generations rose and fell with the cruel rhythm of the tides.

Back when everyone still spat the name Heokbeol-gung in terror, asking any elder of Geurimja Mun about it would make them choke on their tea. Official records of Patriarch Seo Ji-yu have been scrubbed from public circulation for centuries just to preserve the sect's dignity, but the merchant ledgers never lie.

The mess originated centuries prior over a loaded game of dice. An aristocratic merchant lord, blessed with warehouses of electrum and far too many unwed daughters, cornered Ji-yu when he was merely a third-stage Master.

Grandmaster Seol Eun-chae was not a woman to suffer indignity in silence. A legendary beauty of razor-sharp standards, she possessed short silver hair cut with military precision, jade-cold pale skin, and haughty carriage draped in heavy fur-lined silks.`;

  const page2Text = `For the first few seasons, the barge lingered near Ji-yu's dinghy, waiting for the deadbeat Grandmaster to acknowledge his lawful obligations. But decades adrift on the freezing sea have a way of demanding warmth.

It happened on a night when the coastal gale beat mercilessly against the cabin lattice and the brazier coal burned to dying ember. Eun-chae sat rigid before her vanity mirror, her proud spine trembling under the biting northern drafts seeping beneath her collar. Da-eun stepped behind her, hands warmed with spiced plum oil, and quietly unfastened the silver pins binding Eun-chae's collar. When soft, living fingers brushed the nape of Eun-chae's frozen neck, the Grandmaster stiffened—then slowly leaned into the touch. In the dim lantern glow, the iron discipline of a fourth-stage martial artist unraveled like spun silk; Da-eun sank to her knees before her, parting the heavy brocade robes as gently as a spring breeze parting winter reeds. As proud lips parted in a shuddering gasp, Da-eun leaned up and kissed the aristocratic ice clean out of her mistress's mouth, pulling the bed curtains shut against the howl of the eastern wind. In the stifling amber dark of that berth, years of frozen solitude melted into tangled limbs, whispered devotions, and jade skin flushed pink beneath hands that actually knew how to cherish it.

By dawn, neither woman gave a damn about the dinghy.

The two women completely stopped looking for Ji-yu. While the Sect Master drifted in gloom, unwashed and obsessed with the void, the barge became a haven of devoted sapphic bliss. Ji-yu eventually broke into higher realms, establishing the thousand-year foundation of Geurimja Mun. A Proof that the supreme path to the heavens is a solitary road. Eun-chae lived a long life wrapped in Da-eun's doting affection, producing exactly zero heirs to inherit the family legacy. And back in the merchant quarter, her scheming father reportedly spent his final decades bald from rage, coughing blood over his accounting ledgers every time he remembered that his master-stroke political marriage ended with his prideful daughter eloping with her own bridesmaid.`;

  const doc: LootDocument = {
    style: "newspaper",
    title: "EARLIEST GAY INFIDELITY SECT LEADER EVER REGISTERED IN SIRIUS HISTORY!?",
    newspaperSubtitle: "THE HIDDEN LIGHT",
    newspaperHeader: "tabloid-splash",
    newspaperLayout: "editorial-dual",
    content: page1Text + "\n\n---\n\n" + page2Text,
    images: [
      { url: "https://example.com/eun-chae.png", caption: "Grandmaster Seol Eun-chae and her bridesmaid Jung Da-eun" },
      { url: "https://example.com/ji-yu.png", caption: '"Ancestor Seo Ji-yu"' },
    ],
  };

  return doc;
}
