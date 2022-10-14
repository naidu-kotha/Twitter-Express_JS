const express = require("express");
const app = express();
app.use(express.json());

const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const path = require("path");
const dbPath = path.join(__dirname, "twitterClone.db");

let db = null;


// Initialization
const initializeDBAndServer = async() => {
    try {
        db = await open({
            filename: dbPath,
            driver: sqlite3.Database,
        });
        app.listen(3000, () => {
            console.log("Server Running at http://localhost:3000/");
        });
    } catch (e) {
        console.log(`DBError: ${e.message}`);
        process.exit(1);
    };
};

initializeDBAndServer();


// Register User API
app.post("/register/", async(request, response) => {
    const { username, password, name, gender } = request.body;

    const hashedPassword = await bcrypt.hash(password,10);

    const selectUserQuery = `
    SELECT
      *
    FROM
      user
    WHERE
      username = '${username}';`;

    const dbUser = await db.get(selectUserQuery);

    if (dbUser !== undefined) {
        response.status(400);
        response.send("User already exists");
    } else if (password.length < 6) {
        response.status(400);
        response.send("Password is too short");
    } else if (dbUser === undefined) {
        const createUserQuery = `
        INSERT INTO
          user (username, password, name, gender)
        VALUES
          ('${username}', '${hashedPassword}', '${name}', '${gender}');`;

        await db.run(createUserQuery);

        response.send("User created successfully");
    };
});


// Login User API
app.post("/login/" , async(request, response) => {
    const { username, password } = request.body;

    const selectUserQuery = `
    SELECT
      *
    FROM
      user
    WHERE
      username = '${username}';`;

    const dbUser = await db.get(selectUserQuery);

    if (dbUser === undefined) {
        response.status(400);
        response.send("Invalid user");
    } else {
        const passwordMatched = await bcrypt.compare(password, dbUser.password);

        if (passwordMatched) {
            const payload = {username: username};

            const jwtToken = jwt.sign(payload, "secretkey");

            response.send({jwtToken});
        } else {
            response.status(400);
            response.send("Invalid password");
        };
    };
});


// Middleware Authentication Function
const authenticateToken = (request, response, next) => {
    let jwtToken;

    const authHeader = request.headers["authorization"];

    if (authHeader !== undefined) {
        jwtToken = authHeader.split(" ")[1];
    };
    if (jwtToken === undefined) {
        response.status(401);
        response.send("Invalid JWT Token");
    } else {
        jwt.verify(jwtToken, "secretkey", async(error, payload) => {
            if (error) {
                response.status(401);
                response.send("Invalid JWT Token");
            } else {
                request.username = payload.username;
                next();
            };
        });
    };
};


// Get Tweets API
app.get("/user/tweets/feed/", authenticateToken, async(request, response) => {
    const getTweetsQuery = `
    SELECT
      username,
      tweet,
      date_time as dateTime
    FROM
      user NATURAL JOIN tweet INNER JOIN follower on user.user_id = follower.following_user_id
    WHERE 
      follower_user_id = (select user_id from user where username = "${request.username}") 
    ORDER BY
      date_time DESC
    LIMIT
      4;`;

    const tweets = await db.all(getTweetsQuery);
    response.send(tweets);
});


// Get Following Peoples List API
app.get("/user/following/", authenticateToken, async(request, response) => {
    const getFollowingQuery = `
    select 
      user.name 
    FROM
      follower INNER JOIN user ON follower.following_user_id = user.user_id 
    WHERE
      follower_user_id = (SELECT user_id FROM user WHERE username = '${request.username}');`;

    const following = await db.all(getFollowingQuery);
    response.send(following);
});


// Get Followers of User API
app.get("/user/followers/", authenticateToken, async(request, response) => {
    const getFollowersQuery = `
    SELECT
      name
    FROM
      user INNER JOIN follower ON follower.follower_user_id = user.user_id
    WHERE
      following_user_id = (SELECT user_id FROM user WHERE username = '${request.username}');`;

    const followers = await db.all(getFollowersQuery);
    response.send(followers);
});


// Following Check
const follows = async (request, response, next) => {
  const { tweetId } = request.params;
  let isFollowing = await db.get(` 
    SELECT
      *
    FROM
      follower 
    WHERE
      follower_user_id = (SELECT user_id FROM user WHERE username ="${request.username}") AND 
      following_user_id = (SELECT user.user_id FROM tweet NATURAL JOIN user WHERE tweet_id = ${tweetId});`);
  
    if (isFollowing === undefined) {
      response.status(401);
      response.send("Invalid Request");
    } else {
      next();
    };
};


// Get Tweets by Tweet Id API
app.get("/tweets/:tweetId/" ,authenticateToken, follows, async(request, response) => {
    const { tweetId } = request.params;

    const getTweetQuery = `
    SELECT
      tweet.tweet,
      count(like_id) as likes,
      count(reply_id) as replies,
      date_time as dateTime
    FROM
      like INNER JOIN tweet ON like.tweet_id = tweet.tweet_id INNER JOIN reply ON tweet.tweet_id = reply.reply_id
    WHERE
      like.tweet_id = '${tweetId}';`;

    const tweetData = await db.get(getTweetQuery);
    response.send(tweetData);
});


// Get People Who Liked a Users Tweets
app.get("/tweets/:tweetId/likes/", authenticateToken, follows, async(request, response) => {
    const { tweetId } = request.params;

    const likedPeopleNamesQuery = `
    SELECT
      username
    FROM
      user NATURAL JOIN like
    WHERE
      tweet_id = '${tweetId}';`;

    const likedPeople = await db.all(likedPeopleNamesQuery);
    response.send({ likes: likedPeople.map((item) => item.username) });
});


// Get People Who Replied a Users Tweets
app.get("/tweets/:tweetId/replies/", authenticateToken, follows, async (request, response) => {
    const { tweetId } = request.params;
    
    const repliedPeopleNamesQuery = `
    SELECT
      user.name,
      reply.reply
    FROM
      reply natural join user 
    WHERE
      tweet_id = '${tweetId}';`;

    const replies = await db.all(repliedPeopleNamesQuery);

    response.send({ replies });
});


// Get All Tweets of User API
app.get("/user/tweets/", authenticateToken, async (request, response) => {
    const getTweetsQuery = ` 
    SELECT
      tweet.tweet, 
      count(distinct like.like_id) as likes, 
      count(distinct reply.reply_id) as replies, 
      tweet.date_time 
    FROM
      tweet INNER JOIN like ON tweet.tweet_id = like.tweet_id 
      INNER JOIN reply ON tweet.tweet_id = reply.tweet_id 
    WHERE 
      tweet.user_id = (SELECT user_id FROM user WHERE username = "${request.username}") 
    GROUP BY
      tweet.tweet_id;`;

    const tweetsList = await db.all(getTweetsQuery);

    response.send(tweetsList.map((item) => {
        const { date_time, ...rest } = item;
        return { dateTime: date_time, ...rest };
    })
  );
});


// Post Tweet by Logged User API
app.post("/user/tweets/", authenticateToken, async (request, response) => {
    const { tweet } = request.body;
    const getUserIdQuery =`
    SELECT
      user_id
    FROM
      user
    WHERE
      username = "${request.username}";`;
    
    const dbUser = await db.get(getUserIdQuery);
        
    const createTweetQuery = `
    INSERT INTO 
      tweet (tweet, user_id) 
    VALUES
    ("${tweet}", '${dbUser}');`;

    const newTweet = await db.run(createTweetQuery);

    response.send("Created a Tweet");
});


// Delete Tweet by Logged User API
app.delete("/tweets/:tweetId/", authenticateToken, async (request, response) => {
    const { tweetId } = request.params;
    
    const selectUserTweetQuery = ` 
    SELECT
      tweet_id, 
      user_id
    FROM
      tweet
    WHERE
      tweet_id = ${tweetId} AND
      user_id = (SELECT user_id FROM user WHERE username = "${request.username}");`;

    const userTweet = await db.get(selectUserTweetQuery);

    if (userTweet === undefined) {
        response.status(401);
        response.send("Invalid Request");
    } else {
        const deleteTweetQuery = `
        DELETE FROM
          tweet
        WHERE
          tweet_id = '${tweetId}';`;
        
        await db.run(deleteTweetQuery);
        
        response.send("Tweet Removed");
    };
});




module.exports = app;