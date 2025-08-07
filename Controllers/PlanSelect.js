import { UserModel } from "../Schema_Models/UserModel.js";

export default async function(req, res) {
  let { resumeLink, coverLetter, token, userDetails, planType, planLimit } = req.body;

  try {
    const userFromDb = await UserModel.findOneAndUpdate(
      { email: userDetails.email },
      {
        $set: {
          planType,
          resumeLink,
          coverLetter,  // ✅ new field
          planLimit,
        },
      },
      { new: true } // return updated document
    );

    console.log(userFromDb);

    res.status(201).json({
      message: "Plan Selection Success",
      userDetails: {
        email: userFromDb.email,
        name: userFromDb.name,
        planLimit: userFromDb.planLimit,
        planType: userFromDb.planType,
        resumeLink: userFromDb.resumeLink,
        coverLetter: userFromDb.coverLetter,  // ✅ added to response
        userType: userFromDb.userType,
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: "Server error" });
  }
}
