import youtubedl from "youtube-dl-exec";

async function main() {
  try {
    const output = await youtubedl("--version");
    console.log("SUCCESS:", output);
  } catch (e: any) {
    console.error("ERROR:", e);
  }
}
main();
